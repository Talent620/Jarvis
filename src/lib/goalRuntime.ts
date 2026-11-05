// === Runtime trwałych celów (goalRuntime) ===
// Spina wykonawcę (agentRun) z trwałością (goalState): uruchamiając plan, tworzymy REKORD celu w
// IndexedDB, zapisujemy postęp PO KAŻDYM kroku (przeżywa restart) i finalizujemy status z werdyktu.
// Dzięki temu każde uruchomione działanie jest śledzone i widoczne w panelu celu. Kanoniczne wejście
// dla UI (Plan dnia, panel celu). Bez chain-of-thought. S9-safe.

import { makeDefaultExecTool, type RunResult, type StepResult } from "./agentRun";
import { runAgentPipeline } from "./agentPipeline";
import { newGoal, recordStepOutcome, loadGoals, upsertGoal, resumableGoals, type GoalRecord, type GoalStatus, type GoalStorage } from "./goalState";
import type { AgentPlan } from "./agentPlanner";
import { runTool, toolDefs } from "./tools";
import { riskOf } from "./permissions";
import { attempted } from "./actionOutcome";
import { beginGoalRun } from "./goalControl";

const toolExists = (n: string) => toolDefs.some((d) => d.name === n);

/** Pure: końcowy status trwałego celu z werdyktu wykonania. */
function finalStatus(run: RunResult): GoalStatus {
  if (run.verdict.canClaimSuccess) return "completed";
  if (run.status === "failed") return "failed";
  if (run.status === "waiting_user") return "waiting_user";
  if (run.status === "blocked") return run.steps.some((step) => step.outcome.evidence?.message === "brak zgody użytkownika") ? "waiting_consent" : "waiting_user";
  if (run.status === "stopped") return "paused";
  return "running";
}

export interface StartGoalInput {
  goal: string;
  plan: AgentPlan;
  correlationId: string;   // stabilny id (dedup działań zewnętrznych) — z zewnątrz
  now: number;
  onStatus?: (s: string) => void;
  onStep?: (r: StepResult) => void;
}

/**
 * Uruchom cel jako TRWAŁY: utwórz rekord, zapisz, wykonaj plan na prawdziwych narzędziach (bramka
 * zgód przez runTool), zapisując postęp po każdym kroku, i utrwal finalny status. Zwraca rekord + wynik.
 */
export async function startAndRunGoal(input: StartGoalInput, storage?: GoalStorage): Promise<{ record: GoalRecord; result: RunResult }> {
  const control = beginGoalRun(input.correlationId);
  try {
  if ((await loadGoals(storage)).some((g) => g.id === input.correlationId)) throw new Error("Cel o tym identyfikatorze już istnieje — wznów zapisany cel.");
  let record: GoalRecord = { ...newGoal(input.goal, input.plan, input.correlationId, input.now), status: "running" };
  await upsertGoal(record, storage);

  const pipeline = await runAgentPipeline(input.plan, {
    toolExists,
    riskOf,
    execTool: makeDefaultExecTool((name, input) => runTool(name, input, { signal: control.signal }), riskOf),
    shouldStop: control.shouldStop,
    onStatus: input.onStatus,
    beforeTool: async (step) => {
      record = { ...record, results: { ...record.results, [step.id]: attempted(step.tool, "Przygotowano próbę; po awarii sprawdź, czy działanie zostało wykonane.") } };
      await upsertGoal(record, storage);
    },
    onStep: async (r) => {
      record = recordStepOutcome(record, r.id, r.outcome, input.now);
      await upsertGoal(record, storage);
      input.onStep?.(r);
    },
  });
  const result = pipeline.run;

  record = { ...record, status: control.wasStopped() ? "cancelled" : finalStatus(result), updatedAt: input.now };
  await upsertGoal(record, storage);
  return { record, result };
  } finally { control.finish(); }
}

/**
 * WZNÓW I DOKOŃCZ trwały cel: dograj pozostałe kroki, POMIJAJĄC już potwierdzone (i nie ponawiając
 * ATTEMPTED — bez podwójnych działań). Wcześniejsze wyniki idą jako seed do wykonawcy; postęp znów
 * zapisujemy po każdym kroku. Zwraca zaktualizowany rekord + wynik.
 */
export async function resumeAndRunGoal(
  record: GoalRecord,
  opts: { now: number; onStatus?: (s: string) => void; onStep?: (r: StepResult) => void },
  storage?: GoalStorage,
): Promise<{ record: GoalRecord; result: RunResult }> {
  const control = beginGoalRun(record.id);
  try {
  const saved = (await loadGoals(storage)).find((goal) => goal.id === record.id);
  if (!saved) throw new Error("Nie znaleziono zapisanego celu — nie można bezpiecznie go wznowić.");
  if (saved.status === "cancelled") throw new Error("Cel zatrzymano poleceniem STOP. Nie wznowiono go automatycznie.");
  const steps = saved.plan.steps || [];
  const seed: StepResult[] = steps
    .filter((s) => saved.results[s.id])
    .map((s) => ({ id: s.id, intent: s.intent, tool: s.tool, outcome: saved.results[s.id] }));

  let rec: GoalRecord = { ...saved, status: "running", updatedAt: opts.now };
  await upsertGoal(rec, storage);

  const pipeline = await runAgentPipeline(saved.plan, {
    toolExists,
    riskOf,
    execTool: makeDefaultExecTool((name, input) => runTool(name, input, { signal: control.signal }), riskOf),
    seed,
    shouldStop: control.shouldStop,
    onStatus: opts.onStatus,
    beforeTool: async (step) => {
      rec = { ...rec, results: { ...rec.results, [step.id]: attempted(step.tool, "Przygotowano próbę; po awarii sprawdź, czy działanie zostało wykonane.") } };
      await upsertGoal(rec, storage);
    },
    onStep: async (r) => {
      rec = recordStepOutcome(rec, r.id, r.outcome, opts.now);
      await upsertGoal(rec, storage);
      opts.onStep?.(r);
    },
  });
  const result = pipeline.run;

  rec = { ...rec, status: control.wasStopped() ? "cancelled" : finalStatus(result), updatedAt: opts.now };
  await upsertGoal(rec, storage);
  return { record: rec, result };
  } finally { control.finish(); }
}

/** Wczytaj cele posortowane od najnowszych (do panelu). */
export async function loadGoalsNewestFirst(storage?: GoalStorage): Promise<GoalRecord[]> {
  return (await loadGoals(storage)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Cele warte wznowienia po restarcie (do podpowiedzi „wznów cel"). */
export async function resumableGoalsNewestFirst(storage?: GoalStorage): Promise<GoalRecord[]> {
  return resumableGoals(await loadGoalsNewestFirst(storage));
}
