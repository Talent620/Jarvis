// === Jeden mózg we wszystkich trybach głosu (voiceCognition) ===
// Czat, mikrofon, słuchawki, Live i Boss używają TEGO SAMEGO kontrolera poznawczego, pamięci,
// planera i aktywnego celu (przez askJarvis + cognitiveController). Tryby różnią się interfejsem
// i stylem, NIE inteligencją. Ten moduł daje wspólną warstwę głosu: parsowanie komend STEROWANIA
// CELEM (rozpocznij / potwierdź / postęp / zatrzymaj / wznów / co dalej) i skracanie odpowiedzi do
// formy głosowej (krótszej niż ekranowa). Decyzja poznawcza jest IDENTYCZNA niezależnie od trybu —
// to gwarancja parytetu. Czyste i testowalne. S9-safe (jawne klasy, bez /u, \p, lookbehind).

import { classifyCognitionLocal, type CognitiveDecision } from "./cognitiveController";

export type VoiceGoalIntent = "start_goal" | "confirm_step" | "ask_progress" | "pause_plan" | "resume_plan" | "what_next";

export interface VoiceGoalCommand {
  intent: VoiceGoalIntent;
  /** Treść celu po słowie-kluczu (dla start_goal) — bez wartości wrażliwych. */
  payload?: string;
}

// Kolejność MA znaczenie: bardziej szczegółowe wzorce przed ogólnymi.
const START_RE = /\b(rozpocznij cel|zacznij cel|nowy cel|nowe zadanie celu|weź się za|wez sie za|zajmij się celem|zajmij sie celem|cel:)/i;
const CONFIRM_RE = /\b(potwierdzam|potwierdź krok|potwierdz krok|tak,? zrób|tak,? zrob|akceptuję|akceptuje|zgadzam się|zgadzam sie|wykonaj to|tak wykonaj)/i;
const PROGRESS_RE = /\b(jaki postęp|jaki postep|na czym (jesteśmy|jestesmy|stoimy)|jak idzie|ile zostało|ile zostalo|status celu|gdzie jesteśmy z celem|gdzie jestesmy z celem)/i;
const PAUSE_RE = /\b(zatrzymaj|wstrzymaj|pauza|spauzuj|stop plan|zatrzymaj plan|wstrzymaj cel)/i;
const RESUME_RE = /\b(wznów|wznow|kontynuuj plan|kontynuuj cel|wracaj do celu|dalej z celem|wznów cel|wznow cel)/i;
const NEXT_RE = /\b(co dalej|co teraz|następny krok|nastepny krok|co robimy dalej|jaki następny krok|jaki nastepny krok)/i;

/**
 * Pure: rozpoznaj komendę STEROWANIA CELEM w wypowiedzi głosowej. null = zwykła wypowiedź
 * (idzie do mózgu jak każda inna). Dzięki temu głosem można prowadzić cały proces.
 */
export function parseVoiceGoalCommand(text: string): VoiceGoalCommand | null {
  const t = (text || "").trim();
  if (!t) return null;
  if (START_RE.test(t)) {
    const m = t.replace(START_RE, "").replace(/^[\s:,-]+/, "").trim();
    return { intent: "start_goal", payload: m || undefined };
  }
  if (CONFIRM_RE.test(t)) return { intent: "confirm_step" };
  if (PROGRESS_RE.test(t)) return { intent: "ask_progress" };
  if (PAUSE_RE.test(t)) return { intent: "pause_plan" };
  if (RESUME_RE.test(t)) return { intent: "resume_plan" };
  if (NEXT_RE.test(t)) return { intent: "what_next" };
  return null;
}

const VOICE_MAX = 240; // odpowiedzi głosowe KRÓTSZE niż ekranowe

/** Pure: skróć odpowiedź do formy głosowej — bez markdown, na granicy zdania, do limitu znaków. */
export function shortenForVoice(text: string, maxChars = VOICE_MAX): string {
  const s = (text || "")
    .replace(/```[\s\S]*?```/g, " ")              // bloki kodu precz
    .replace(/[*_#>`]+/g, "")                       // markdown precz
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")        // linki → sam tekst
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  // Utnij na ostatniej granicy zdania, a jak brak — na ostatniej spacji.
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastStop > maxChars * 0.5) return cut.slice(0, lastStop + 1).trim();
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Pure: decyzja poznawcza dla głosu — DOKŁADNIE ten sam kontroler co w czacie (parytet).
 * Niezależnie od trybu (mikrofon/słuchawki/Live/Boss) ten sam tekst daje tę samą decyzję.
 */
export function voiceCognition(text: string, opts: { hasImage?: boolean } = {}): CognitiveDecision {
  return classifyCognitionLocal(text, { hasImage: opts.hasImage });
}
