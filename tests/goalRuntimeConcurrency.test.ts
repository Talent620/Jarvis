import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmed } from "../src/lib/actionOutcome";
import { runPlan, type RunDeps, type StepResult } from "../src/lib/agentRun";
import type { AgentPlan } from "../src/lib/agentPlanner";
import { verifyRun } from "../src/lib/resultVerifier";
import { cancelGoal, loadGoals, mutateGoal, newGoal, pauseGoal, upsertGoal, type GoalStorage } from "../src/lib/goalState";

const pipeline = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/agentPipeline", () => ({ runAgentPipeline: pipeline }));
import { resumeAndRunGoal } from "../src/lib/goalRuntime";

// IndexedDB returns snapshots, not references to a live in-memory record.
function snapshotStorage() {
  const data = new Map<string, unknown>();
  let nextRead: (() => void) | undefined;
  const storage: GoalStorage = {
    get: async (key) => {
      const snapshot = data.has(key) ? structuredClone(data.get(key)) : null;
      const callback = nextRead;
      nextRead = undefined;
      callback?.();
      return snapshot as never;
    },
    set: async (key, value) => { data.set(key, structuredClone(value)); return true; },
  };
  return { storage, onNextRead: (callback: () => void) => { nextRead = callback; } };
}

const plan: AgentPlan = { goal: "przegląd", steps: [{ id: "read", intent: "odczytaj zadania", tool: "list_tasks" }] };
const step: StepResult = { ...plan.steps[0], outcome: confirmed({ message: "zapisany dowód" }), output: "wynik odczytu" };
const result = {
  run: {
    status: "completed" as const, steps: [step], toolCalls: 1, summary: "zapisano",
    verdict: verifyRun({ goal: plan.goal, steps: [step] }),
  },
  events: [], approved: true,
};

beforeEach(() => { pipeline.mockReset(); });

describe("goalRuntime — decyzja użytkownika podczas zapisu workera", () => {
  it("anulowanie między odczytem finału a zapisem nie zostaje nadpisane przez completed", async () => {
    const { storage, onNextRead } = snapshotStorage();
    const initial = newGoal("przegląd", plan, "final-cancel", 1);
    await upsertGoal(initial, storage);
    let cancelled: Promise<unknown> | undefined;
    pipeline.mockImplementation(async (_plan: AgentPlan, deps: RunDeps) => {
      await deps.onStep?.(step);
      onNextRead(() => { cancelled = mutateGoal(initial.id, (current) => cancelGoal(current, 3), storage); });
      return result;
    });

    await resumeAndRunGoal(initial, { now: 2 }, storage);
    await cancelled;
    const saved = (await loadGoals(storage))[0];
    expect(saved.status).toBe("failed");
    expect(saved.error).toBe("anulowane przez użytkownika");
    expect(saved.results.read.state).toBe("CONFIRMED");
    expect(saved.outputs?.read).toBe("wynik odczytu");
  });

  it("pauza podczas zapisu kroku zachowuje dowód i wynik bez wznowienia celu", async () => {
    const { storage, onNextRead } = snapshotStorage();
    const initial = newGoal("przegląd", plan, "step-pause", 1);
    await upsertGoal(initial, storage);
    let paused: Promise<unknown> | undefined;
    pipeline.mockImplementation(async (_plan: AgentPlan, deps: RunDeps) => {
      onNextRead(() => { paused = mutateGoal(initial.id, (current) => pauseGoal(current, 3), storage); });
      await deps.onStep?.(step);
      await paused;
      return result;
    });

    await resumeAndRunGoal(initial, { now: 2 }, storage);
    const saved = (await loadGoals(storage))[0];
    expect(saved.status).toBe("paused");
    expect(saved.results.read.state).toBe("CONFIRMED");
    expect(saved.outputs?.read).toBe("wynik odczytu");
  });

  it.each(["pause", "cancel"] as const)("stary wpis queued nie nadpisuje decyzji %s przed startem", async (action) => {
    const { storage } = snapshotStorage();
    const initial = newGoal("przegląd", plan, `claim-${action}`, 1);
    await upsertGoal(initial, storage);
    await mutateGoal(initial.id, (current) => action === "pause" ? pauseGoal(current, 2) : cancelGoal(current, 2), storage);
    pipeline.mockImplementation(async (currentPlan: AgentPlan, deps: RunDeps) => ({ run: await runPlan(currentPlan, deps), events: [], approved: false }));

    const run = await resumeAndRunGoal(initial, { now: 3 }, storage);
    expect(run.result.toolCalls).toBe(0);
    expect(run.record.status).toBe(action === "pause" ? "paused" : "failed");
    if (action === "cancel") expect(run.record.error).toBe("anulowane przez użytkownika");
  });

  it("wyjątek późnego workera nie usuwa powodu anulowania", async () => {
    const { storage } = snapshotStorage();
    const initial = newGoal("przegląd", plan, "cancel-error", 1);
    await upsertGoal(initial, storage);
    pipeline.mockImplementation(async () => {
      await mutateGoal(initial.id, (current) => cancelGoal(current, 2), storage);
      throw new Error("opóźniony błąd dostawcy");
    });
    await expect(resumeAndRunGoal(initial, { now: 3 }, storage)).rejects.toThrow("opóźniony błąd dostawcy");
    const saved = (await loadGoals(storage))[0];
    expect(saved.status).toBe("failed");
    expect(saved.error).toBe("anulowane przez użytkownika");
  });
});
