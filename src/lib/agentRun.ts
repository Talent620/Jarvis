// === Wykonawca planu (agent runtime) ===
// Zweryfikowany plan (agentPlanner.validatePlan) NIE jest tylko JSON-em — tu jest WYKONYWANY na
// REALNYCH narzędziach JARVIS-a. Kroki idą wg dependsOn; narzędzie musi istnieć; przed outbound
// lub ryzykownym zapisem wymagana jest zgoda; bezpieczne odczyty idą automatycznie. Każdy krok
// zapisuje ActionOutcome i NIE wykonujemy kroków zależnych od niepotwierdzonego poprzednika.
// Liczba kroków i wywołań narzędzi jest ograniczona (anti-loop). Czysty rdzeń + wstrzykiwane
// zależności → w pełni testowalny bez prawdziwych efektów ubocznych. S9-safe.

import type { AgentPlan, PlanStep } from "./agentPlanner";
import type { ActionOutcome } from "./actionOutcome";
import { confirmed, failed, draft, attempted } from "./actionOutcome";
import type { Risk } from "./permissions";

export interface StepResult {
  id: string;
  intent: string;
  tool?: string;
  outcome: ActionOutcome;
  output?: string;
  /** Krok pominięty (zależność niepotwierdzona / brak zgody / limit). */
  skipped?: boolean;
  reason?: string;
}

export type RunStatus = "completed" | "blocked" | "failed" | "stopped";

export interface RunResult {
  status: RunStatus;
  steps: StepResult[];
  toolCalls: number;
  /** Krótkie, jawne podsumowanie (bez chain-of-thought). */
  summary: string;
}

export interface RunDeps {
  toolExists: (name: string) => boolean;
  riskOf: (name: string) => Risk;
  /** Wykonanie kroku z narzędziem → ActionOutcome (+ opcjonalny output). Read = auto. */
  execTool: (name: string, args: Record<string, unknown> | undefined, step: PlanStep) => Promise<{ outcome: ActionOutcome; output?: string }>;
  /** Opcjonalny PRE-gate zgody (outbound / ryzykowny zapis). Brak → zgodę egzekwuje execTool/runTool. */
  requestConsent?: (step: PlanStep, risk: Risk) => Promise<boolean>;
  onStatus?: (msg: string) => void;
  now?: () => number;
  maxSteps?: number;
  maxToolCalls?: number;
}

const DEFAULT_MAX_STEPS = 12;
const DEFAULT_MAX_TOOL_CALLS = 8;

/** Pure: porządek wykonania wg dependsOn (Kahn). Cykl/niespójność → resztę w kolejności wejścia. */
export function topoOrder(steps: PlanStep[]): PlanStep[] {
  const ids = new Set(steps.map((s) => s.id));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of steps) indeg.set(s.id, 0);
  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      if (!ids.has(dep)) continue;
      adj.set(dep, [...(adj.get(dep) || []), s.id]);
      indeg.set(s.id, (indeg.get(s.id) || 0) + 1);
    }
  }
  const byId = new Map(steps.map((s) => [s.id, s]));
  const queue = steps.filter((s) => (indeg.get(s.id) || 0) === 0).map((s) => s.id);
  const order: PlanStep[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = byId.get(id);
    if (s) order.push(s);
    for (const nx of adj.get(id) || []) {
      indeg.set(nx, (indeg.get(nx) || 0) - 1);
      if ((indeg.get(nx) || 0) <= 0) queue.push(nx);
    }
  }
  // Dołóż ewentualne nieodwiedzone (np. resztki cyklu) w kolejności wejścia — defensywnie.
  for (const s of steps) if (!seen.has(s.id)) order.push(s);
  return order;
}

const short = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Czy zgoda jest wymagana dla tego ryzyka/kroku? Outbound zawsze; write tylko gdy requiresConsent. */
function needsConsent(risk: Risk, step: PlanStep): boolean {
  if (risk === "outbound") return true;
  if (risk === "write" && step.requiresConsent === true) return true;
  return false;
}

/**
 * Wykonaj zweryfikowany plan. Zwraca wynik per krok (ActionOutcome) + status całości.
 * Bezpiecznie: nieznane narzędzie → FAILED; brak zgody → krok pominięty (DRAFT); kroki zależne
 * od niepotwierdzonego poprzednika → pominięte; limity kroków/wywołań chronią przed zapętleniem.
 */
export async function runPlan(plan: AgentPlan, deps: RunDeps): Promise<RunResult> {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxToolCalls = deps.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const steps = (plan.steps || []).slice(0, maxSteps);
  const order = topoOrder(steps);
  const total = order.length;
  const results = new Map<string, StepResult>();
  let toolCalls = 0;
  let stoppedByLimit = false;

  const depConfirmed = (step: PlanStep): boolean =>
    (step.dependsOn || []).every((d) => results.get(d)?.outcome.state === "CONFIRMED");

  let pos = 0;
  for (const step of order) {
    pos += 1;
    if (deps.onStatus) deps.onStatus(`${short(step.intent)} — krok ${pos} z ${total}`);

    // Zależności muszą być POTWIERDZONE (nie FAILED/ATTEMPTED/SIMULATED/DRAFT).
    if (!depConfirmed(step)) {
      results.set(step.id, { id: step.id, intent: step.intent, tool: step.tool, outcome: draft("zależność niepotwierdzona"), skipped: true, reason: "zależność niepotwierdzona" });
      continue;
    }

    // Krok czysto myślowy (bez narzędzia) → uznaj za wewnętrznie wykonany.
    if (!step.tool) {
      results.set(step.id, { id: step.id, intent: step.intent, outcome: confirmed({ source: "wewnętrzny", message: "krok analityczny" }) });
      continue;
    }

    if (!deps.toolExists(step.tool)) {
      results.set(step.id, { id: step.id, intent: step.intent, tool: step.tool, outcome: failed(`nieznane narzędzie: ${step.tool}`), reason: "nieznane narzędzie" });
      continue;
    }

    const risk = deps.riskOf(step.tool);

    // Zgoda przed outbound / ryzykownym zapisem (jeśli podano pre-gate).
    if (needsConsent(risk, step) && deps.requestConsent) {
      const ok = await deps.requestConsent(step, risk);
      if (!ok) {
        results.set(step.id, { id: step.id, intent: step.intent, tool: step.tool, outcome: draft("brak zgody użytkownika"), skipped: true, reason: "brak zgody" });
        continue;
      }
    }

    // Limit wywołań narzędzi (anti-loop) — reszta kroków zostaje pominięta.
    if (toolCalls >= maxToolCalls) {
      stoppedByLimit = true;
      results.set(step.id, { id: step.id, intent: step.intent, tool: step.tool, outcome: draft("limit wywołań narzędzi"), skipped: true, reason: "limit narzędzi" });
      continue;
    }

    try {
      toolCalls += 1;
      const { outcome, output } = await deps.execTool(step.tool, step.arguments, step);
      results.set(step.id, { id: step.id, intent: step.intent, tool: step.tool, outcome, output });
    } catch (e) {
      results.set(step.id, { id: step.id, intent: step.intent, tool: step.tool, outcome: failed(e instanceof Error ? e.message : "błąd narzędzia"), reason: "błąd narzędzia" });
    }
  }

  const ordered = order.map((s) => results.get(s.id)).filter(Boolean) as StepResult[];
  const anyFailed = ordered.some((r) => r.outcome.state === "FAILED");
  const anySkipped = ordered.some((r) => r.skipped);
  const status: RunStatus = stoppedByLimit ? "stopped" : anyFailed ? "failed" : anySkipped ? "blocked" : "completed";

  const done = ordered.filter((r) => r.outcome.state === "CONFIRMED").length;
  const summary =
    status === "completed" ? `Wykonano i potwierdzono wszystkie kroki (${done}/${total}).`
    : status === "failed" ? `Część kroków się nie powiodła — potwierdzono ${done}/${total}.`
    : status === "stopped" ? `Zatrzymano na limicie wywołań — potwierdzono ${done}/${total}.`
    : `Wstrzymano (zgoda/zależność) — potwierdzono ${done}/${total}.`;

  return { status, steps: ordered, toolCalls, summary };
}

/**
 * Domyślny wykonawca narzędzia dla RUNTIME — przez prawdziwy runTool (jedna bramka zgód + audyt).
 * Mapuje wynik na ActionOutcome zachowawczo: odczyt/zapis bez błędu → CONFIRMED (lokalny, dowodliwy),
 * outbound bez dowodu dostarczenia → ATTEMPTED (potwierdzenie domknie weryfikator/Task 5).
 * Odmowa zgody → DRAFT; nieznane narzędzie → FAILED.
 */
export function makeDefaultExecTool(runTool: (name: string, input: unknown) => Promise<string>, riskOf: (name: string) => Risk) {
  return async (name: string, args: Record<string, unknown> | undefined, _step: PlanStep): Promise<{ outcome: ActionOutcome; output?: string }> => {
    void _step;
    const out = await runTool(name, args ?? {});
    const text = typeof out === "string" ? out : "";
    if (/^Nieznane narzędzie/i.test(text)) return { outcome: failed(`nieznane narzędzie: ${name}`), output: text };
    if (/^Anulowano/i.test(text)) return { outcome: draft("brak zgody użytkownika"), output: text };
    const risk = riskOf(name);
    if (risk === "outbound") return { outcome: attempted(name, "wykonano — czekam na potwierdzenie dostarczenia"), output: text };
    return { outcome: confirmed({ source: name, message: "wykonano lokalnie" }), output: text };
  };
}
