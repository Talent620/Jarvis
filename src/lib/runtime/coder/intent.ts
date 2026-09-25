// Polish grammar of coding commands (M12), no model: start a coding task, change a running one
// ("dodaj jeszcze X", "nie rób release", "najpierw przetestuj"), ask about it, show the diff,
// continue an interrupted one. Plain "stop", "pauza", "wznów" stay kernel controls: a coding
// task is a kernel task, so they reach it through the same path as any other task.

import { normalizeUtterance } from "../util";
import type { BackendChoice } from "./types";

export type CoderIntent =
  | { kind: "start"; goal: string; backend?: BackendChoice; access: "read" | "write"; explicit: boolean }
  | { kind: "constraint"; constraint: string }
  | { kind: "instruction"; instruction: string }
  | { kind: "status" }
  | { kind: "diff" }
  | { kind: "continue" }
  | { kind: "stop" }
  | { kind: "pause" }
  | { kind: "resume" };

export interface CoderIntentContext {
  /** A coding task is running or paused. */
  live: boolean;
  /** Some coding task exists in this session (for "pokaż zmiany"). */
  any: boolean;
  /** A coding task was interrupted by a restart and can be continued. */
  interrupted: boolean;
  /** The task in focus is a coding task (so "dodaj jeszcze ..." is about it). */
  focusedCode?: boolean;
  /** The words are also a screen command ("jeszcze niżej", "wyślij to"): never the agent's. */
  screenCommand?: boolean;
}

const WRITE_VERBS = /\b(napraw\w*|popraw\w*|zrefaktor\w*|refaktor\w*|zaimplementuj\w*|implementuj\w*|dodaj (?:funkcj\w*|obslug\w*|testy?|endpoint\w*|opcj\w*|walidacj\w*)|zdebuguj\w*|usun (?:blad|bug\w*)|napisz (?:testy?|funkcj\w*|kod)|zaktualizuj zaleznosci|przepisz)\b/;
const READ_VERBS = /\b(przeanalizuj\w*|przejrzyj\w*|zrob (?:review|przeglad)|znajdz (?:blad|bledy|bug\w*|przyczyn\w*)|wyjasnij (?:kod|jak dziala)|sprawdz (?:kod|projekt|repo\w*))\b/;
/** Words that make it about code even without a known project name. */
const CODE_CONTEXT = /\b(projekt\w*|repo\w*|kod\w*|aplikacj\w*|codex\w*|claude code|agent\w* (?:kodu|programist\w*)|test\w*|build\w*|funkcj\w*)\b/;
const EXPLICIT_AGENT = /\b(codex\w*|claude code|claude\w*|agent\w* programist\w*|lokaln\w* model\w*)\b/;

const CONSTRAINTS: [RegExp, string][] = [
  [/\b(nie rob (?:zadnego )?release\w*|bez release\w*|nie wydawaj|nie publikuj|nie rob wydania|bez wydania)\b/, "nie rób release"],
  [/\b(nie commituj|bez commit\w*|nie rob commit\w*)\b/, "nie commituj"],
  [/\b(nie pushuj|nie wypychaj|bez push\w*)\b/, "nie pushuj"],
  [/\b(najpierw (?:przetestuj|testy|uruchom testy|odpal testy|puść testy|pusc testy|sprawdz testy))\b/, "najpierw przetestuj"],
];

function backendOf(n: string): BackendChoice | undefined {
  if (/\bcodex\w*/.test(n)) return "codex";
  if (/\bclaude\w*/.test(n)) return "claude";
  if (/\blokaln\w* model\w*|\blokalnie\b/.test(n)) return "local";
  return undefined;
}

const EDIT_VERB = "(?:dodaj|dopisz|zmień|zmien|popraw|zrób|zrob|napraw|usuń|usun|zaktualizuj|przenieś|przenies|napisz|uzupełnij|uzupelnij)";
/** "dodaj jeszcze X", "i przy okazji popraw X": an editing verb is required, bare "jeszcze" is not. */
const TO_AGENT = "(?:(?:codex\\w*|claude\\w*|agenc\\w*|agent\\w*)[,:]?\\s+)?";
const INSTRUCTION_A = new RegExp(`^\\s*${TO_AGENT}(?:(?:i|a|oraz)\\s+)?${EDIT_VERB}\\s+(?:jeszcze|przy okazji|dodatkowo)\\s+(.{3,})$`, "i");
const INSTRUCTION_B = new RegExp(`^\\s*${TO_AGENT}(?:(?:i|a|oraz)\\s+)?(?:jeszcze|przy okazji|dodatkowo)\\s+(${EDIT_VERB}\\s+.{3,})$`, "i");

/** The instruction in the user's own spelling. */
function instructionOf(text: string): string | null {
  const m = INSTRUCTION_A.exec(text) ?? INSTRUCTION_B.exec(text);
  return m ? m[1].trim().replace(/[.!]+$/, "") : null;
}

/** Words that make a "nie ruszaj X" about code, not about an e-mail or a page. */
const CODE_THING = /\b(plik\w*|kod\w*|test\w*|funkcj\w*|modul\w*|katalog\w*|folder\w*|klas\w*|konfiguracj\w*|zaleznosc\w*|api|schemat\w*|migracj\w*|\w+ (?:ts|js|tsx|py|json|md|css|yml|yaml))\b/;

export function parseCoderIntent(text: string, ctx: CoderIntentContext): CoderIntent | null {
  const n = normalizeUtterance(text);
  if (!n) return null;
  const aboutAgent = /\b(codex\w*|agent\w*|claude\w*|kodowani\w*|programist\w*)\b/.test(n);

  // A change to the running agent only when it is about the agent or its code, never a command
  // for the screen or a chat sentence said while the agent works.
  const forAgent = aboutAgent || !!ctx.focusedCode;
  if (ctx.live) {
    if (!ctx.screenCommand) {
      for (const [re, constraint] of CONSTRAINTS) if (re.test(n)) return { kind: "constraint", constraint };
      const nieRuszaj = /^(?:i\s+)?nie (?:ruszaj|zmieniaj|dotykaj) (.{2,})$/.exec(n);
      if (nieRuszaj && forAgent && CODE_THING.test(nieRuszaj[1])) return { kind: "constraint", constraint: `nie zmieniaj ${nieRuszaj[1]}` };
    }
    // "dodaj jeszcze komentarz w add.js" also parses as a screen command (a YouTube comment); an
    // editing verb with "jeszcze" while the coding task is in focus is the agent's.
    const extra = forAgent ? instructionOf(text) : null;
    if (extra) return { kind: "instruction", instruction: extra };
    if (aboutAgent && /\b(zatrzymaj|przerwij|stop|anuluj|zakoncz)\b/.test(n)) return { kind: "stop" };
    if (aboutAgent && /\b(wstrzymaj|pauza|zapauzuj)\b/.test(n)) return { kind: "pause" };
    if (aboutAgent && /\b(wznow|odpauzuj)\b/.test(n)) return { kind: "resume" };
  }
  if ((ctx.live || ctx.any) && (/\b(co (?:teraz )?robi|jak (?:idzie|mu idzie|tam idzie)|na jakim (?:jest )?etapie|jaki (?:jest )?postep|ile (?:testow|plikow))\b/.test(n) && aboutAgent)) return { kind: "status" };
  if ((ctx.live || ctx.any) && !ctx.screenCommand && (/\b(pokaz|wyswietl|otworz) (?:mi )?diff\w*\b/.test(n)
    || ((aboutAgent || ctx.focusedCode) && /\b(pokaz|wyswietl|otworz) (?:mi )?(?:zmiany|roznice)\b/.test(n))
    || /\bco (?:agent|codex|claude)\w* zmienil\w*/.test(n))) return { kind: "diff" };
  if (ctx.interrupted && !ctx.live && /^(?:dobra |ok |okej )?(kontynuuj|dokoncz|wznow|rob dalej)(?: (?:to|zadanie|kodowanie|prace|programowanie|to zadanie))?$/.test(n)) return { kind: "continue" };

  const write = WRITE_VERBS.test(n);
  const read = !write && READ_VERBS.test(n);
  if (!write && !read) return null;
  return {
    kind: "start",
    goal: text.trim(),
    backend: backendOf(n),
    access: write ? "write" : "read",
    // Said with a coding word or the agent's name: JARVIS answers even when the project is unknown.
    explicit: EXPLICIT_AGENT.test(n) || CODE_CONTEXT.test(n),
  };
}

/** Cheap pre-check (no state): could this be a coding command at all? */
export function mightBeCoding(text: string): boolean {
  const n = normalizeUtterance(text);
  return WRITE_VERBS.test(n) || READ_VERBS.test(n) || EXPLICIT_AGENT.test(n);
}
