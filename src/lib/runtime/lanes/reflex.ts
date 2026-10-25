// REFLEX lane (mission 5.2): Polish control grammar without an LLM.
// Tier 0 (stop, pause, interrupt) may run on a stable partial when VAD confirms user speech.
// Tier 1 (scroll, next item, local reversible actions) is only prepared on a partial and runs
// on the final. Tier 2 (writes, external effects, mail, deleting) never runs from a partial.

import type { ControlKind } from "../events";
import { parseCommand, type Command } from "../commands";
import { normalizeUtterance } from "../util";

export type Tier = 0 | 1 | 2;

export type Reflex =
  | { kind: "control"; control: ControlKind; tier: Tier; confidence: number }
  | { kind: "action"; command: Command; tier: Tier }
  | { kind: "none" };

const STOP = /^(?:(?:nie|no|hej|jarvis)\s+)?(stop|stoj|przestan|przerwij|zatrzymaj(?: sie)?|koniec|dosc|wystarczy|anuluj|cancel|stopuj)(?:\s+(?:to|juz|natychmiast|prosze|stop))*$/;
const PAUSE = /^(?:(?:jarvis|hej)\s+)?(poczekaj|czekaj|zaczekaj|chwila|chwileczke|chwilke|moment|momencik|pauza|wstrzymaj(?: sie)?|sekunda|sekundke)(?:\s+(?:chwile|chwilke|moment|sekunde|prosze|jeszcze))*$/;
const RESUME = /^(?:(?:dobra|ok|okej|dobrze|juz)\s+)?(wznow|kontynuuj|rob dalej|jedz dalej|lec dalej|dzialaj dalej|mozesz kontynuowac|mozesz dalej|wracaj do pracy)$/;
const UNDO = /^(?:(?:nie|jarvis)\s+)?(cofnij|cofnij to|odwroc|odwroc to|wroc to|cofnij ostatnie)$/;
const CONFIRM = /^(tak|tak jest|dobra|dobrze|ok|okej|zgoda|potwierdzam|wysylaj|wyslij|jasne|pewnie|zrob to|tak wyslij)$/;
const REJECT = /^(nie|nie wysylaj|odrzuc|nie rob tego|anuluj wysylke|nie teraz)$/;

/** Words that grant consent for an external effect. "ok", "dobra", "jasne" are too casual. */
const STRICT_CONSENT = /^(tak|tak jest|tak wyslij|wyslij|wysylaj|potwierdzam|zgoda|zgadzam sie)$/;
export const isStrictConsent = (text: string): boolean => STRICT_CONSENT.test(normalizeUtterance(text));

/** Classify an utterance (partial or final). Controls are whole short utterances only. */
export function classifyReflex(text: string): Reflex {
  const norm = normalizeUtterance(text);
  if (!norm) return { kind: "none" };
  if (STOP.test(norm)) return { kind: "control", control: "stop", tier: 0, confidence: 0.95 };
  if (PAUSE.test(norm)) return { kind: "control", control: "pause", tier: 0, confidence: 0.9 };
  if (RESUME.test(norm)) return { kind: "control", control: "resume", tier: 1, confidence: 0.9 };
  if (UNDO.test(norm)) return { kind: "control", control: "undo", tier: 1, confidence: 0.9 };
  if (CONFIRM.test(norm)) return { kind: "control", control: "confirm", tier: 2, confidence: 0.85 };
  if (REJECT.test(norm)) return { kind: "control", control: "reject", tier: 2, confidence: 0.85 };
  // "dalej" alone: resume a paused task, otherwise the next item (decided with state by the router).
  if (norm === "dalej" || norm === "dobra dalej" || norm === "ok dalej") return { kind: "control", control: "next", tier: 1, confidence: 0.7 };
  const command = parseCommand(text);
  if (command.type !== "unknown") return { kind: "action", command, tier: 1 };
  return { kind: "none" };
}

export interface PartialPolicy {
  /** Minimum provider stability for tier 0 on a partial. */
  minStability: number;
  /** Tier 0 partials longer than this many words are not treated as a bare command. */
  maxWords: number;
}

export const DEFAULT_PARTIAL_POLICY: PartialPolicy = { minStability: 0.7, maxWords: 4 };

/** May this partial trigger a control right now (tier 0, user speech, stable, short)? */
export function tier0FromPartial(text: string, stability: number, userSpeech: boolean, policy: PartialPolicy = DEFAULT_PARTIAL_POLICY): ControlKind | null {
  if (!userSpeech || stability < policy.minStability) return null;
  const norm = normalizeUtterance(text);
  if (!norm || norm.split(" ").length > policy.maxWords) return null;
  const r = classifyReflex(norm);
  return r.kind === "control" && r.tier === 0 ? r.control : null;
}
