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
import { verifyRun, type RuntimeVerdict } from "./resultVerifier";
import { classifyError, type RecoveryDecision } from "./recoveryPolicy";
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

export type RunStatus = "completed" | "blocked" | "failed" | "stopped" | "waiting_user";

export interface RunResult {
  status: RunStatus;
  steps: StepResult[];
  toolCalls: number;
  /** Krótkie, jawne podsumowanie (bez chain-of-thought) — pochodzi z weryfikatora. */
  summary: string;
  /** Uczciwy werdykt końcowy (5 stanów). canClaimSuccess=true tylko, gdy WSZYSTKO potwierdzone. */
  verdict: RuntimeVerdict;
}

export interface RunDeps {
  toolExists: (name: string) => boolean;
  riskOf: (name: string) => Risk;
  /** Wykonanie kroku z narzędziem → ActionOutcome (+ opcjonalny output). Read = auto. */
  execTool: (name: string, args: Record<string, unknown> | undefined, step: PlanStep) => Promise<{ outcome: ActionOutcome; output?: string }>;
  /** Opcjonalny PRE-gate zgody (outbound / ryzykowny zapis). Brak → zgodę egzekwuje execTool/runTool. */
  requestConsent?: (step: PlanStep, risk: Risk) => Promise<boolean>;
  /** Durable checkpoint przed uruchomieniem narzędzia; wyjątek blokuje wykonanie. */
  beforeTool?: (step: PlanStep, risk: Risk) => Promise<void>;
  onStatus?: (msg: string) => void;
  /** Wołane po KAŻDYM kroku (z jego wynikiem) — pozwala trwale zapisać postęp (durable goals). */
  onStep?: (result: StepResult) => void | Promise<void>;
  now?: () => number;
  /** Pauza nie przerywa trwającego działania; blokuje start kolejnego kroku lub próby. */
  shouldStop?: () => boolean;
  maxSteps?: number;
  maxToolCalls?: number;
  /** Polityka samonaprawy: gdy krok rzuci błąd, decyduje o retry/replan/abort. Bez niej brak retry. */
  recover?: (err: unknown, risk: Risk, attempt: number) => RecoveryDecision;
  /** Opóźnienie między próbami (wstrzykiwane — w testach natychmiastowe). */
  sleep?: (ms: number) => Promise<void>;
  /** Maks. prób wykonania JEDNEGO kroku (łącznie z pierwszą). Domyślnie 3. */
  maxToolAttempts?: number;
  /** Wznowienie: wcześniejsze wyniki kroków. CONFIRMED/ATTEMPTED/FAILED NIE są wykonywane ponownie
   *  (bez podwójnych działań), ale liczą się jako spełnione/blokujące zależności. */
  seed?: StepResult[];
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
  // Wznowienie: zaszczep wcześniejsze wyniki (kroki już CONFIRMED/ATTEMPTED/FAILED nie ruszają ponownie).
  for (const s of deps.seed || []) results.set(s.id, s);
  let toolCalls = 0;
  let stoppedByLimit = false;
  let stoppedByRequest = false;

  const depConfirmed = (step: PlanStep): boolean =>
    (step.dependsOn || []).every((d) => results.get(d)?.outcome.state === "CONFIRMED");

  // Policz jeden krok do StepResult (mutuje toolCalls/stoppedByLimit przez domknięcie).
  const evalStep = async (step: PlanStep): Promise<StepResult | null> => {
    const base = { id: step.id, intent: step.intent, tool: step.tool };
    // Zależności muszą być POTWIERDZONE (nie FAILED/ATTEMPTED/SIMULATED/DRAFT).
    if (!depConfirmed(step)) return { ...base, outcome: draft("zależność niepotwierdzona"), skipped: true, reason: "zależność niepotwierdzona" };
    // Plan opisujący analizę nie jest jej wykonaniem ani dowodem wyniku.
    if (!step.tool) return { ...base, outcome: draft("brak wykonawcy tego kroku"), skipped: true, reason: "brak wykonawcy tego kroku" };
    if (!deps.toolExists(step.tool)) return { ...base, outcome: failed(`nieznane narzędzie: ${step.tool}`), reason: "nieznane narzędzie" };

    const risk = deps.riskOf(step.tool);
    // Zgoda przed outbound / ryzykownym zapisem (jeśli podano pre-gate).
    if (needsConsent(risk, step) && deps.requestConsent) {
      const ok = await deps.requestConsent(step, risk);
      if (!ok) return { ...base, outcome: draft("brak zgody użytkownika"), skipped: true, reason: "brak zgody" };
    }
    if (deps.shouldStop?.()) { stoppedByRequest = true; return null; }
    // Limit wywołań narzędzi (anti-loop) — reszta kroków zostaje pominięta.
    if (toolCalls >= maxToolCalls) {
      stoppedByLimit = true;
      return { ...base, outcome: draft("limit wywołań narzędzi"), skipped: true, reason: "limit narzędzi" };
    }
    // Checkpoint zapisuje się przed jakimkolwiek efektem ubocznym; jego błąd nie może być ponowiony jako błąd narzędzia.
    if (deps.beforeTool) await deps.beforeTool(step, risk);
    if (deps.shouldStop?.()) { stoppedByRequest = true; return null; }
    // Wykonanie z bezpieczną samonaprawą: chwilowy błąd odczytu → retry z backoff.
    // Outbound NIGDY nie jest ponawiany automatycznie (recoveryPolicy zwróci wtedy ask_user).
    const maxAttempts = Math.max(1, deps.maxToolAttempts ?? 3);
    let attempt = 0;
    let lastReason: string | undefined;
    for (;;) {
      if (deps.shouldStop?.()) { stoppedByRequest = true; return null; }
      try {
        toolCalls += 1;
        const { outcome, output } = await deps.execTool(step.tool, step.arguments, step);
        return { ...base, outcome, output, skipped: outcome.state === "DRAFT" || undefined, reason: outcome.state === "DRAFT" ? outcome.evidence?.message : lastReason };
      } catch (e) {
        // Przy zapisie/akcji zewnętrznej wyjątek mógł wystąpić po efekcie ubocznym.
        // Nie ponawiaj i nie twierdź, że działanie na pewno się nie powiodło.
        if (risk !== "read") return { ...base, outcome: attempted(step.tool, "Wystąpił błąd po rozpoczęciu działania. Sprawdź wynik przed ponowieniem."), reason: "niepewny wynik" };
        if (!deps.recover) return { ...base, outcome: failed(e instanceof Error ? e.message : "błąd narzędzia"), reason: "błąd narzędzia" };
        const decision = deps.recover(e, risk, attempt);
        lastReason = decision.reason;
        if (risk === "read" && decision.action === "retry_backoff" && attempt + 1 < maxAttempts && toolCalls < maxToolCalls) {
          attempt += 1;
          if (decision.delayMs > 0 && deps.sleep) await deps.sleep(decision.delayMs);
          continue; // ponów ten sam krok
        }
        // Brak retry (np. outbound / zły argument / trwały błąd) → zapisz wynik z czytelnym powodem.
        const kind = classifyError(e);
        const out = kind === "consent_denied" ? draft(decision.reason) : failed(decision.reason);
        return { ...base, outcome: out, skipped: decision.action === "skip", reason: decision.reason };
      }
    }
  };

  let pos = 0;
  for (const step of order) {
    if (deps.shouldStop?.()) { stoppedByRequest = true; break; }
    pos += 1;
    // Wznowienie: krok już potwierdzony, rozpoczęty lub nieudany NIE wykonuje się ponownie —
    // brak podwójnych działań; jego wynik z seeda zostaje i liczy się do zależności.
    const seeded = results.get(step.id);
    if (seeded && (seeded.outcome.state === "CONFIRMED" || seeded.outcome.state === "ATTEMPTED" || seeded.outcome.state === "FAILED")) continue;
    if (deps.onStatus) deps.onStatus(`${short(step.intent)} — krok ${pos} z ${total}`);
    const r = await evalStep(step);
    if (!r) break;
    results.set(step.id, r);
    if (deps.onStep) await deps.onStep(r); // trwały zapis postępu (durable goals)
  }

  const ordered = order.map((s) => results.get(s.id)).filter(Boolean) as StepResult[];
  const anyFailed = ordered.some((r) => r.outcome.state === "FAILED");
  const anySkipped = ordered.some((r) => r.skipped);
  const anyAttempted = ordered.some((r) => r.outcome.state === "ATTEMPTED");
  const status: RunStatus = stoppedByLimit || stoppedByRequest ? "stopped" : anyFailed ? "failed" : anyAttempted ? "waiting_user" : anySkipped ? "blocked" : "completed";

  // Werdykt końcowy ZAWSZE z weryfikatora — jedyne źródło uczciwego statusu (bez „Gotowe" bez dowodu).
  // Weryfikuj cały plan także po pauzie; wykonany prefiks nie jest ukończonym celem.
  const verdict = verifyRun({ goal: plan.goal, steps: (plan.steps || []).map((step) => {
    const result = results.get(step.id);
    return { id: step.id, intent: step.intent, outcome: result?.outcome ?? draft("krok jeszcze nie wykonany"), skipped: result?.skipped ?? !result };
  }) });

  return { status, steps: ordered, toolCalls, summary: verdict.summary, verdict };
}

/** Wbudowane odczyty wyłącznie z lokalnego store, bez usług zewnętrznych. */
const VERIFIED_LOCAL_READS = new Set(["list_tasks", "list_notes", "list_shopping", "list_leads"]);

/**
 * Legacy runTool zwraca tekst, nie ustrukturyzowany wynik i dowód. Nie można na jego
 * podstawie uznać dowolnej akcji za potwierdzoną. Wynik niejednoznaczny zostaje jako
 * ATTEMPTED, aby wznowienie nie wykonało go ponownie bez sprawdzenia użytkownika.
 */
export function makeDefaultExecTool(runTool: (name: string, input: unknown) => Promise<string>, riskOf: (name: string) => Risk) {
  return async (name: string, args: Record<string, unknown> | undefined, _step: PlanStep): Promise<{ outcome: ActionOutcome; output?: string }> => {
    void _step;
    const out = await runTool(name, args ?? {});
    const text = typeof out === "string" ? out : "";
    const trimmed = text.trim();
    if (/^Anulowano/i.test(trimmed)) return { outcome: draft("brak zgody użytkownika"), output: text };
    if (/^(?:Nieznane narzędzie|Błąd narzędzia|Błąd wyszukiwania|Nie udało się|Ta czynność jest zablokowana)/i.test(trimmed)) {
      return { outcome: failed(trimmed, name), output: text };
    }
    if (riskOf(name) === "read" && VERIFIED_LOCAL_READS.has(name) && trimmed) {
      return { outcome: confirmed({ source: name, message: "odczytano dane lokalne" }), output: text };
    }
    return { outcome: attempted(name, "Wynik wymaga sprawdzenia; brak jednoznacznego potwierdzenia."), output: text };
  };
}
