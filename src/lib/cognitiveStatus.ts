// === Panel „Co JARVIS robi i dlaczego" — model danych (cognitiveStatus) ===
// Autonomia JARVIS-a ma być WIDOCZNA i kontrolowalna, a nie magiczna. Ten pure-builder składa
// uczciwy widok stanu: aktywny cel, bieżący krok, model/provider, użyte źródła, narzędzia,
// oczekujące zgody, koszt/tokeny, pewność i OSTATNI POTWIERDZONY rezultat. NIE pokazuje toku
// myślenia, kluczy API, promptów systemowych ani prywatnych podpisów rozumowania (redakcja).
// Czysty i testowalny; komponent tylko renderuje ten model. S9-safe (bez /u, \p, lookbehind).

import type { GoalRecord } from "./goalState";
import { describeGoal } from "./goalState";
import type { RunResult } from "./agentRun";

export interface CognitiveStatusView {
  goal?: { text: string; statusLabel: string; progress: string };
  currentStep?: string;
  model?: string;
  provider?: string;
  sources: string[];
  tools: string[];
  pendingConsents: string[];
  tokens?: number;
  cost?: number;
  confidence?: number;       // 0..1
  lastConfirmed?: string;
  /** Czy cel da się zatrzymać (UI pokazuje przycisk Stop). */
  canStop: boolean;
}

// Wzorce sekretów do REDAKCJI (nigdy nie pokazujemy kluczy/podpisów). S9-safe.
const KEYISH = /(sk-[A-Za-z0-9]{6,}|AIza[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+|[A-Za-z0-9_-]{32,})/g;

/** Pure: usuń z tekstu sekrety/podpisy myślenia (redakcja). */
export function redactSecret(s: string): string {
  return (s || "")
    .replace(KEYISH, "[ukryte]")
    .replace(/thoughtSignature\S*/gi, "[ukryte]")
    .replace(/\bthought_signature\S*/gi, "[ukryte]");
}

const STATUS_LABEL: Record<GoalRecord["status"], string> = {
  queued: "w kolejce", running: "w toku", waiting_consent: "czeka na zgodę",
  waiting_user: "czeka na sprawdzenie", paused: "wstrzymany", completed: "ukończony", failed: "nieudany",
};

const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))];

export interface CognitiveStatusInput {
  goal?: GoalRecord | null;
  run?: RunResult | null;
  model?: string;
  provider?: string;
  /** Etykiety źródeł użytego kontekstu (np. „lead:Firma X", „finanse"). */
  sources?: string[];
  tokens?: number;
  cost?: number;
  confidence?: number;
}

/**
 * Pure: zbuduj uczciwy, zredagowany widok stanu poznawczego. Bez chain-of-thought, bez sekretów.
 * Pusty wejściowo → minimalny widok (UI pokaże „bezczynny"). Ostatni rezultat tylko CONFIRMED.
 */
export function buildCognitiveStatus(input: CognitiveStatusInput): CognitiveStatusView {
  const goal = input.goal || undefined;
  const run = input.run || undefined;

  const steps = run?.steps || [];
  const current = steps.find((s) => s.outcome.state !== "CONFIRMED" && !s.skipped) || steps.find((s) => s.skipped);
  const tools = uniq(steps.map((s) => s.tool || "").filter(Boolean)).map(redactSecret);
  const pendingConsents = uniq(
    steps.filter((s) => s.reason === "brak zgody" || (s.skipped && s.outcome.state === "DRAFT")).map((s) => s.intent || s.tool || ""),
  ).map(redactSecret);
  const confirmedSteps = steps.filter((s) => s.outcome.state === "CONFIRMED");
  const lastConfirmed = confirmedSteps.length ? redactSecret(confirmedSteps[confirmedSteps.length - 1].intent || "krok wykonany") : undefined;

  const goalView = goal
    ? { text: redactSecret(goal.goal), statusLabel: STATUS_LABEL[goal.status], progress: describeGoal(goal) }
    : undefined;

  return {
    goal: goalView,
    currentStep: current ? redactSecret(current.intent || current.tool || "") : undefined,
    model: input.model ? redactSecret(input.model) : undefined,
    provider: input.provider ? redactSecret(input.provider) : undefined,
    sources: uniq((input.sources || []).map(redactSecret)),
    tools,
    pendingConsents,
    tokens: input.tokens,
    cost: input.cost,
    confidence: typeof input.confidence === "number" ? Math.max(0, Math.min(1, input.confidence)) : undefined,
    lastConfirmed,
    canStop: !!goal && (goal.status === "running" || goal.status === "queued" || goal.status === "waiting_consent" || goal.status === "waiting_user" || goal.status === "paused"),
  };
}
