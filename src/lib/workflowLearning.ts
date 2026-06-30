// === Naucz mnie raz: procedury i rutyny (workflowLearning) ===
// Marcin może nauczyć JARVIS-a swojej pracy BEZ programowania. Gdy ta sama sekwencja narzędzi
// powtarza się (np. lead → teczka → oferta → mail → follow-up) co najmniej 3 razy, proponujemy
// zapis PROCEDURY: parametry, kroki, wymagane zgody i kryteria sukcesu. Procedury są lokalne,
// edytowalne i usuwalne. BEZPIECZEŃSTWO: nie zapisujemy sekretów ani treści maili jako stałych
// argumentów (tylko NAZWY parametrów), a zgoda na jedno narzędzie NIE rozszerza się na całą
// procedurę (każdy krok outbound nadal wymaga zgody). Czyste i testowalne. S9-safe.

import type { AgentPlan, PlanStep } from "./agentPlanner";
import type { Risk } from "./permissions";

export interface ExecutionTrace {
  id: string;
  tools: string[];   // kolejność wywołanych narzędzi (BEZ wartości argumentów)
  at: number;
  /** Klucze argumentów (nie wartości!) — do wyłonienia parametrów procedury. */
  argKeys?: string[];
}

export interface WorkflowProposal {
  signature: string;
  tools: string[];
  count: number;
  paramKeys: string[];
}

export interface ProcedureStep {
  tool: string;
  requiresConsent: boolean;  // outbound/ryzykowny → zgoda PER KROK
}

export interface WorkflowProcedure {
  id: string;
  name: string;
  steps: ProcedureStep[];
  parameters: string[];      // NAZWY parametrów (nigdy wartości/sekrety)
  successCriteria?: string;
  createdAt: number;
  updatedAt: number;
}

const MIN_REPEATS = 3;
// Klucze, których NIGDY nie utrwalamy jako parametry/argumenty (sekrety, treści, dane wrażliwe).
const SECRET_KEYS = /\b(password|haslo|hasło|token|secret|apikey|api_key|klucz|body|tresc|treść|content|message|wiadomosc|wiadomość|email_body|pin|otp)\b/i;

/** Pure: podpis sekwencji narzędzi (kolejność się liczy; wartości argumentów NIE). */
export function traceSignature(tools: string[]): string {
  return (tools || []).join(" > ");
}

/** Pure: tylko NAZWY parametrów warte zapamiętania (sekrety/treści odrzucone). */
export function safeParamKeys(keys: string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const k of keys || []) {
    const key = (k || "").trim();
    if (!key || SECRET_KEYS.test(key)) continue;
    seen.add(key);
  }
  return [...seen];
}

/**
 * Pure: wykryj powtarzalny workflow. Grupuje ślady po podpisie sekwencji; gdy któryś powtórzył się
 * ≥ minRepeats razy → propozycja. Różne sekwencje / za mało powtórzeń → null (brak fałszywych trafień).
 */
export function detectRepeatedWorkflow(traces: ExecutionTrace[], minRepeats = MIN_REPEATS): WorkflowProposal | null {
  const groups = new Map<string, ExecutionTrace[]>();
  for (const t of traces || []) {
    if (!t.tools || t.tools.length < 2) continue; // pojedyncze narzędzie to nie procedura
    const sig = traceSignature(t.tools);
    groups.set(sig, [...(groups.get(sig) || []), t]);
  }
  let best: { sig: string; items: ExecutionTrace[] } | null = null;
  for (const [sig, items] of groups) {
    if (items.length >= minRepeats && (!best || items.length > best.items.length)) best = { sig, items };
  }
  if (!best) return null;
  const paramKeys = safeParamKeys(best.items.flatMap((t) => t.argKeys || []));
  return { signature: best.sig, tools: best.items[0].tools, count: best.items.length, paramKeys };
}

/** Pure: zbuduj procedurę z propozycji. Zgoda PER KROK (outbound/ryzykowny) — nie blankietowa. */
export function buildProcedure(
  proposal: WorkflowProposal,
  opts: { id: string; name: string; riskOf: (tool: string) => Risk; now: number; successCriteria?: string },
): WorkflowProcedure {
  const steps: ProcedureStep[] = proposal.tools.map((tool) => ({
    tool,
    requiresConsent: opts.riskOf(tool) === "outbound", // każdy outbound osobno
  }));
  return {
    id: opts.id,
    name: opts.name,
    steps,
    parameters: safeParamKeys(proposal.paramKeys),  // tylko nazwy, bez sekretów
    successCriteria: opts.successCriteria,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/**
 * Pure: zamień procedurę na plan do wykonania. KAŻDY krok outbound zachowuje requiresConsent=true,
 * więc zgoda na jeden krok NIE rozszerza się na całą procedurę (agentRun pyta osobno).
 * Wartości parametrów wstrzykujemy w RUNTIME (nie są zapisane w procedurze — żadnych sekretów).
 */
export function procedureToPlan(proc: WorkflowProcedure, params: Record<string, unknown>, opts: { goal?: string }): AgentPlan {
  const steps: PlanStep[] = proc.steps.map((s, i) => ({
    id: `s${i + 1}`,
    intent: `Krok procedury: ${s.tool}`,
    tool: s.tool,
    arguments: pickParams(params, proc.parameters),
    dependsOn: i > 0 ? [`s${i}`] : undefined,
    requiresConsent: s.requiresConsent || undefined,
  }));
  return { goal: opts.goal || proc.name, steps, confidence: 0.8 };
}

function pickParams(params: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (k in (params || {})) out[k] = params[k];
  return out;
}

/** Pure: krótki podgląd procedury (pokazywany PRZED uruchomieniem). */
export function procedurePreview(proc: WorkflowProcedure): string {
  const chain = proc.steps.map((s) => `${s.tool}${s.requiresConsent ? " (zgoda)" : ""}`).join(" → ");
  const params = proc.parameters.length ? ` · parametry: ${proc.parameters.join(", ")}` : "";
  return `Procedura „${proc.name}": ${chain}${params}`;
}

/** Pure: edycja procedury (nazwa/kryteria/kroki) — lokalna, odwracalna. */
export function editProcedure(list: WorkflowProcedure[], id: string, patch: Partial<Pick<WorkflowProcedure, "name" | "successCriteria" | "steps" | "parameters">>, now: number): WorkflowProcedure[] {
  return list.map((p) => (p.id === id ? { ...p, ...patch, parameters: patch.parameters ? safeParamKeys(patch.parameters) : p.parameters, updatedAt: now } : p));
}

/** Pure: usuń procedurę. */
export function removeProcedure(list: WorkflowProcedure[], id: string): WorkflowProcedure[] {
  return list.filter((p) => p.id !== id);
}
