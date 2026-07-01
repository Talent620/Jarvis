// === Runtime trwałych celów (goalRuntime) ===
// Spina wykonawcę (agentRun) z trwałością (goalState): uruchamiając plan, tworzymy REKORD celu w
// IndexedDB, zapisujemy postęp PO KAŻDYM kroku (przeżywa restart) i finalizujemy status z werdyktu.
// Dzięki temu każde uruchomione działanie jest śledzone i widoczne w panelu celu. Kanoniczne wejście
// dla UI (Plan dnia, panel celu). Bez chain-of-thought. S9-safe.

import { runPlan, makeDefaultExecTool, type RunResult, type StepResult } from "./agentRun";
import { newGoal, recordStepOutcome, loadGoals, upsertGoal, resumableGoals, type GoalRecord, type GoalStatus, type GoalStorage } from "./goalState";
import type { AgentPlan } from "./agentPlanner";
import { runTool, toolDefs } from "./tools";
import { riskOf } from "./permissions";

const toolExists = (n: string) => toolDefs.some((d) => d.name === n);

/** Pure: końcowy status trwałego celu z werdyktu wykonania. */
function finalStatus(run: RunResult): GoalStatus {
  if (run.verdict.canClaimSuccess) return "completed";
  if (run.status === "failed") return "failed";
  if (run.status === "blocked") return "waiting_consent"; // wstrzymane na zgodzie/zależności
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
  let record: GoalRecord = { ...newGoal(input.goal, input.plan, input.correlationId, input.now), status: "running" };
  await upsertGoal(record, storage);

  const result = await runPlan(input.plan, {
    toolExists,
    riskOf,
    execTool: makeDefaultExecTool(runTool, riskOf),
    onStatus: input.onStatus,
    onStep: async (r) => {
      record = recordStepOutcome(record, r.id, r.outcome, input.now);
      await upsertGoal(record, storage);
      input.onStep?.(r);
    },
  });

  record = { ...record, status: finalStatus(result), updatedAt: input.now };
  await upsertGoal(record, storage);
  return { record, result };
}

/** Wczytaj cele posortowane od najnowszych (do panelu). */
export async function loadGoalsNewestFirst(storage?: GoalStorage): Promise<GoalRecord[]> {
  return (await loadGoals(storage)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Cele warte wznowienia po restarcie (do podpowiedzi „wznów cel"). */
export async function resumableGoalsNewestFirst(storage?: GoalStorage): Promise<GoalRecord[]> {
  return resumableGoals(await loadGoalsNewestFirst(storage));
}
