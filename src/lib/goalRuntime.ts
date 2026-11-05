import { makeDefaultExecTool, type RunResult, type StepResult } from "./agentRun";
import { runAgentPipeline } from "./agentPipeline";
import { newGoal, recordStepOutcome, loadGoals, upsertGoal, resumableGoals, type GoalRecord, type GoalStatus, type GoalStorage } from "./goalState";
import { attempted } from "./actionOutcome";
import type { AgentPlan } from "./agentPlanner";
import { runTool, toolDefs } from "./tools";
import { riskOf } from "./permissions";
import { classifyError, decideRecovery } from "./recoveryPolicy";

const toolExists = (name: string) => toolDefs.some((tool) => tool.name === name);
const active = new Set<string>();
export const isGoalRunning = (id: string): boolean => active.has(id);

function finalStatus(run: RunResult): GoalStatus {
  if (run.verdict.canClaimSuccess) return "completed";
  if (run.steps.some((step) => step.outcome.state === "ATTEMPTED")) return "waiting_user";
  if (run.status === "failed") return "failed";
  if (run.status === "stopped") return "paused";
  if (run.steps.some((step) => step.outcome.state === "DRAFT" && /zgod/.test(step.outcome.evidence?.message || ""))) return "waiting_consent";
  if (run.status === "blocked") return "waiting_consent";
  return "waiting_user";
}

export interface StartGoalInput {
  goal: string;
  plan: AgentPlan;
  correlationId: string;
  now: number;
  onStatus?: (s: string) => void;
  onStep?: (r: StepResult) => void;
}

export async function startAndRunGoal(input: StartGoalInput, storage?: GoalStorage): Promise<{ record: GoalRecord; result: RunResult }> {
  if (active.has(input.correlationId)) throw new Error("Ten cel jest już wykonywany.");
  const existing = (await loadGoals(storage)).find((goal) => goal.id === input.correlationId);
  const record = existing || newGoal(input.goal, input.plan, input.correlationId, input.now);
  if (!existing) await upsertGoal(record, storage);
  return resumeAndRunGoal(record, input, storage);
}

export async function resumeAndRunGoal(
  record: GoalRecord,
  opts: { now: number; onStatus?: (s: string) => void; onStep?: (r: StepResult) => void },
  storage?: GoalStorage,
): Promise<{ record: GoalRecord; result: RunResult }> {
  if (active.has(record.id)) throw new Error("Ten cel jest już wykonywany.");
  active.add(record.id);
  let rec = record;
  const latest = async () => (await loadGoals(storage)).find((goal) => goal.id === record.id);
  try {
    rec = { ...(await latest() || record), status: "running", error: undefined, updatedAt: Date.now() };
    await upsertGoal(rec, storage);
    const seed: StepResult[] = rec.plan.steps.filter((step) => rec.results[step.id]).map((step) => ({
      id: step.id, intent: step.intent, tool: step.tool, outcome: rec.results[step.id], output: rec.outputs?.[step.id],
    }));
    const stopped = async () => {
      const current = await latest();
      return !current || current.status === "paused" || current.error === "anulowane przez użytkownika";
    };
    const pipeline = await runAgentPipeline(rec.plan, {
      toolExists, riskOf, execTool: makeDefaultExecTool(runTool, riskOf), seed,
      shouldStop: stopped,
      recover: (error, risk, attempt) => decideRecovery({ kind: classifyError(error), risk: risk === "read" ? "read" : "outbound", attempt }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onStatus: opts.onStatus,
      execAnalysis: async (step, context) => {
        const { askModel } = await import("./brain");
        const previous = context.filter((item) => step.dependsOn?.includes(item.id))
          .map((item) => `${item.intent}:\n${(item.output || "Brak wyniku").slice(0, 12000)}`).join("\n\n");
        return askModel({ system: "Wykonaj analizę na podstawie podanych wyników. Podaj konkretny rezultat po polsku. Nie twierdź, że wykonałeś akcje systemowe.", history: [{ role: "user", content: `Cel: ${rec.goal}\nZadanie: ${step.intent}\n${previous}` }], heavy: true });
      },
      beforeTool: async (step, risk) => {
        if (risk === "read") return;
        const current = await latest();
        if (!current) throw new Error("Cel usunięto.");
        rec = { ...current, results: { ...current.results, [step.id]: attempted(step.tool, "Rozpoczęto operację; po przerwaniu sprawdź jej wynik przed ponowieniem.") }, updatedAt: Date.now() };
        await upsertGoal(rec, storage);
      },
      onStep: async (step) => {
        const current = await latest();
        if (!current) return;
        const paused = current.status === "paused" || current.error === "anulowane przez użytkownika";
        rec = recordStepOutcome(current, step.id, step.outcome, Date.now());
        rec.outputs = { ...current.outputs, ...(step.output ? { [step.id]: step.output.slice(0, 40000) } : {}) };
        if (paused) rec.status = current.status;
        await upsertGoal(rec, storage);
        opts.onStep?.(step);
      },
    });
    const result = pipeline.run;
    const current = await latest();
    if (current) {
      const paused = current.status === "paused" || current.error === "anulowane przez użytkownika";
      rec = { ...current, status: paused ? current.status : finalStatus(result), updatedAt: Date.now(),
        error: current.error || (result.verdict.canClaimSuccess ? undefined : result.steps.find((step) => step.outcome.state === "FAILED")?.outcome.evidence?.message) };
      await upsertGoal(rec, storage);
    }
    return { record: rec, result };
  } catch (error) {
    const current = await latest();
    if (current) await upsertGoal({ ...current, status: "failed", error: error instanceof Error ? error.message : "Błąd wykonania", updatedAt: Date.now() }, storage);
    throw error;
  } finally { active.delete(record.id); }
}

export async function loadGoalsNewestFirst(storage?: GoalStorage): Promise<GoalRecord[]> {
  return (await loadGoals(storage)).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function resumableGoalsNewestFirst(storage?: GoalStorage): Promise<GoalRecord[]> {
  return resumableGoals(await loadGoalsNewestFirst(storage));
}
