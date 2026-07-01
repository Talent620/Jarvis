// === Warstwa spinająca Cognitive OS z runtime (cognitiveRuntime) ===
// To NIE nowy silnik — to adapter/koordynator, który komponuje ISTNIEJĄCE, odłączone silniki w
// funkcje realnie wołane przez UI/runtime (jak campaignStore/campaignRoi dla kampanii). Dzięki temu
// businessSimulator, proactiveOoda, learningLoop i CognitiveStatus mają produkcyjne wywołania, a nie
// tylko testy jednostkowe. Oszczędnie: żadnych ciężkich modeli — czyste, lokalne złożenie danych. S9-safe.

import type { Lead, FinanceProject } from "../types";
import { decideSuggestion, type ProactiveSuggestion, type OodaCategory } from "./proactiveOoda";
import { buildSnapshot, biggestRevenueBlocker } from "./businessSimulator";
import { buildCognitiveStatus, type CognitiveStatusView, type CognitiveStatusInput } from "./cognitiveStatus";
import { detectCorrection, upsertCorrection, activeRules, type Correction } from "./learningLoop";
import { detectRepeatedWorkflow, type ExecutionTrace, type WorkflowProposal } from "./workflowLearning";
import type { OutcomeGoal } from "./goalGraph";

export interface DayInsights {
  /** Jedna proaktywna sugestia OODA (obserwuj→zorientuj→zdecyduj) albo null. */
  suggestion: ProactiveSuggestion | null;
  /** Największe wąskie gardło przychodu (cyfrowy bliźniak biznesu). */
  blocker: { blocker: string; reason: string };
  /** Ryzyka ze snapshotu biznesu (należności, brak kontaktów, projekty po terminie). */
  risks: string[];
}

/**
 * Pure: proaktywne wnioski na „Plan dnia" — komponuje proactiveOoda (co teraz) i businessSimulator
 * (największy bloker + ryzyka) z REALNYCH danych. To ścieżka, którą wywołuje panel (produkcyjny konsument).
 */
export function dayInsights(
  data: { leads?: Lead[]; finance?: FinanceProject[] },
  now: number,
  opts: { goals?: OutcomeGoal[]; rejected?: Set<OodaCategory> } = {},
): DayInsights {
  const suggestion = decideSuggestion(
    { leads: data.leads, finance: data.finance },
    { now, goals: opts.goals, rejected: opts.rejected },
  );
  const snap = buildSnapshot({ finance: data.finance, leads: data.leads, now });
  return { suggestion, blocker: biggestRevenueBlocker(snap), risks: snap.risks };
}

/** Runtime: uczciwy widok stanu poznawczego (redakcja sekretów w środku). */
export function statusView(input: CognitiveStatusInput): CognitiveStatusView {
  return buildCognitiveStatus(input);
}

/**
 * Pure: z wiadomości użytkownika wykryj KOREKTĘ i dołóż ją do zbioru reguł (learningLoop). Zwraca
 * zaktualizowaną listę + czy coś wykryto. Runtime wywołuje to na turze użytkownika (tylko realna korekta).
 */
export function learnFromUserMessage(
  rules: Correction[],
  text: string,
  opts: { id: string; source: string; now: number },
): { rules: Correction[]; learned: boolean } {
  const det = detectCorrection(text);
  if (!det) return { rules, learned: false };
  const res = upsertCorrection(rules, det, opts);
  return { rules: res.list, learned: true };
}

// — workflowLearning: nauka powtarzalnych procedur z realnych przebiegów —
const MAX_TRACES = 60;

/** Pure: dopisz ślad wykonania (kolejność narzędzi, BEZ wartości argumentów). Trzymamy ostatnie N. */
export function recordTrace(traces: ExecutionTrace[], tools: string[], opts: { id: string; now: number; argKeys?: string[] }): ExecutionTrace[] {
  const clean = (tools || []).filter(Boolean);
  if (clean.length < 2) return traces; // pojedyncze narzędzie to nie procedura
  const next = [...(traces || []), { id: opts.id, tools: clean, at: opts.now, argKeys: opts.argKeys }];
  return next.slice(-MAX_TRACES);
}

/** Pure: wykryj powtarzalną procedurę z zebranych śladów (albo null). */
export function learnedProcedure(traces: ExecutionTrace[]): WorkflowProposal | null {
  return detectRepeatedWorkflow(traces || []);
}

/** Pure: aktywne reguły korekt jako zwięzły blok do promptu (puste → ""). */
export function correctionRulesBlock(rules: Correction[]): string {
  const active = activeRules(rules);
  if (!active.length) return "";
  const lines = active.slice(0, 8).map((r) => `- ${r.directive}`);
  return `Twoje trwałe korekty (stosuj je bezwzględnie):\n${lines.join("\n")}`;
}
