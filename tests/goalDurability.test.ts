import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPlan } from "../src/lib/agentPlanner";
import type { GoalStorage } from "../src/lib/goalState";
import { startAndRunGoal, resumeAndRunGoal, loadGoalsNewestFirst } from "../src/lib/goalRuntime";

const effects = vi.hoisted(() => ({ execute: vi.fn(async () => "Dostarczono") }));
vi.mock("../src/lib/tools", () => ({
  toolDefs: [{ name: "gmail_send" }],
  runTool: effects.execute,
}));

const plan: AgentPlan = { goal: "wysyłka", steps: [{ id: "send", intent: "wyślij", tool: "gmail_send" }] };
function recordingStore() {
  let saved: unknown = null;
  let writes = 0;
  let failAt = 0;
  const storage: GoalStorage = {
    get: async <T>() => saved === null ? null : structuredClone(saved) as T,
    set: async (_key, value) => {
      writes++;
      if (writes === failAt) return false;
      saved = structuredClone(value);
      return true;
    },
  };
  return { storage, setFailure: (n: number) => { failAt = n; } };
}
beforeEach(() => { effects.execute.mockClear(); });

describe("trwały checkpoint przed efektem ubocznym", () => {
  it("zapisuje próbę przed uruchomieniem i nie powtarza jej po awarii zapisu rezultatu", async () => {
    const { storage, setFailure } = recordingStore();
    setFailure(3); // rekord celu i checkpoint zapisane, zapis po wykonaniu zawodzi
    await expect(startAndRunGoal({ goal: "wysyłka", plan, correlationId: "DURABLE-SEND", now: 1 }, storage)).rejects.toThrow(/Nie udało się zapisać/);
    expect(effects.execute).toHaveBeenCalledTimes(1);
    const [saved] = await loadGoalsNewestFirst(storage);
    expect(saved.results.send.state).toBe("ATTEMPTED");
    // Nawet nieaktualny obiekt z UI nie może nadpisać zapisanego checkpointu.
    const stale = { ...saved, results: {} };
    const resumed = await resumeAndRunGoal(stale, { now: 2 }, storage);
    expect(effects.execute).toHaveBeenCalledTimes(1);
    expect(resumed.record.results.send.state).toBe("ATTEMPTED");
    expect(resumed.record.status).toBe("waiting_user");
  });
  it("nie uruchamia narzędzia, jeśli zapis checkpointu zawiódł", async () => {
    const { storage, setFailure } = recordingStore();
    setFailure(2);
    await expect(startAndRunGoal({ goal: "wysyłka", plan, correlationId: "DURABLE-FAIL", now: 1 }, storage)).rejects.toThrow(/Nie udało się zapisać/);
    expect(effects.execute).not.toHaveBeenCalled();
  });
  it("nie pozwala zastąpić wcześniej zapisanego celu tym samym identyfikatorem", async () => {
    const { storage } = recordingStore();
    await startAndRunGoal({ goal: "wysyłka", plan, correlationId: "DURABLE-EXISTS", now: 1 }, storage);
    await expect(startAndRunGoal({ goal: "wysyłka", plan, correlationId: "DURABLE-EXISTS", now: 2 }, storage)).rejects.toThrow(/już istnieje/);
    expect(effects.execute).toHaveBeenCalledTimes(1);
  });
  it("nie wykonuje akcji, gdy odczyt magazynu jest niedostępny", async () => {
    const storage: GoalStorage = { get: async () => { throw new Error("awaria odczytu"); }, set: async () => true };
    await expect(startAndRunGoal({ goal: "wysyłka", plan, correlationId: "DURABLE-READ", now: 1 }, storage)).rejects.toThrow("awaria odczytu");
    expect(effects.execute).not.toHaveBeenCalled();
  });
});

it("nie ponawia zapisu po wyjątku, nawet gdy polityka zaleca retry", async () => {
  const { runPlan } = await import("../src/lib/agentRun");
  const perform = vi.fn(async () => { throw new Error("utracono potwierdzenie"); });
  const result = await runPlan({ goal: "plik", steps: [{ id: "write", intent: "zapisz", tool: "file_write" }] }, {
    toolExists: () => true,
    riskOf: () => "write",
    execTool: perform,
    recover: () => ({ action: "retry_backoff", delayMs: 0, reason: "chwilowy błąd" }),
  });
  expect(perform).toHaveBeenCalledTimes(1);
  expect(result.status).toBe("waiting_user");
  expect(result.steps[0].outcome.state).toBe("ATTEMPTED");
});
