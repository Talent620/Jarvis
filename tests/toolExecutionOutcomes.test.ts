// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "../src/lib/tools";
import { makeDefaultExecTool } from "../src/lib/agentRun";
import { startAndRunGoal } from "../src/lib/goalRuntime";
import { loadGoals, type GoalStorage } from "../src/lib/goalState";
import { riskOf } from "../src/lib/permissions";
import { store } from "../src/lib/store";

const previous = { ...store.settings, keys: { ...store.settings.keys } };
const emptyKeys = Object.fromEntries(Object.keys(store.settings.keys).map((key) => [key, ""]));
const exec = makeDefaultExecTool(runTool, riskOf);
function memoryStorage(): GoalStorage {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (structuredClone(values.get(key) ?? null) as T | null),
    set: async (key, value) => { values.set(key, structuredClone(value)); return true; },
  };
}

beforeEach(() => {
  store.setSettings({ ...previous, keys: emptyKeys, ollamaUrl: "", proxyUrl: "" });
  store.setData((data) => { data.tasks = []; data.memory = []; data.financeProjects = []; data.audit = []; });
});
afterEach(() => store.setSettings(previous));

describe("explicit mutator failures reach durable goal outcomes", () => {
  it("missing complete_task target produces FAILED with a reason, never a completed goal", async () => {
    const storage = memoryStorage();
    const step = { id: "complete", intent: "Zakończ wskazane zadanie", tool: "complete_task", arguments: { query: "nieistniejące" } };
    const { record, result } = await startAndRunGoal({
      goal: step.intent, plan: { goal: step.intent, steps: [step] }, correlationId: "missing-task", now: Date.now(),
    }, storage);

    expect(store.data.tasks).toHaveLength(0);
    expect(record.status).toBe("failed");
    expect(result.verdict.canClaimSuccess).toBe(false);
    expect(record.results.complete.state).toBe("FAILED");
    expect(record.results.complete.evidence?.message).toContain("Nie znalazłem aktywnego zadania");
    expect((await loadGoals(storage))[0].results.complete.state).toBe("FAILED");
    expect(store.data.audit[0]).toMatchObject({ tool: "complete_task", status: "error" });
  });

  it("successful complete_task changes the actual task and persists CONFIRMED", async () => {
    await runTool("add_task", { title: "Sprawdzone zadanie" });
    const step = { id: "complete", intent: "Zakończ wskazane zadanie", tool: "complete_task", arguments: { query: "Sprawdzone" } };
    const { record, result } = await startAndRunGoal({
      goal: step.intent, plan: { goal: step.intent, steps: [step] }, correlationId: "existing-task", now: Date.now(),
    }, memoryStorage());

    expect(store.data.tasks[0].done).toBe(true);
    expect(record.status).toBe("completed");
    expect(record.results.complete.state).toBe("CONFIRMED");
    expect(result.verdict.canClaimSuccess).toBe(true);
  });

  it.each([
    ["forget_fact", { key: "missing" }],
    ["import_lead_candidates", { companies: [] }],
    ["switch_ai", { provider: "gemini" }],
    ["switch_ai", { provider: "unknown-provider" }],
    ["lock_assistant", {}],
    ["set_theme", { theme: "unknown-theme" }],
    ["set_mode", { mode: "unknown-mode" }],
    ["set_preference", {}],
    ["set_voice", {}],
    ["finance_set_status", { name: "missing", status: "lead" }],
    ["finance_set_status", { name: "missing", status: "invalid" }],
    ["finance_set_status", { name: "missing", status: "oplacone" }],
  ] as const)("%s reports non-execution structurally", async (tool, args) => {
    const result = await exec(tool, args, { id: "step", intent: "test", tool });
    expect(JSON.parse(result.output!)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(result.outcome.state).toBe("FAILED");
    expect(result.outcome.evidence?.message).toBeTruthy();
    expect(store.data.audit[0]).toMatchObject({ tool, status: "error" });
  });

  it("an empty read remains a successful read, rather than a failed mutation", async () => {
    const result = await exec("list_tasks", {}, { id: "list", intent: "Odczytaj zadania", tool: "list_tasks" });
    expect(result.outcome.state).toBe("CONFIRMED");
    expect(result.output).toBeTruthy();
    expect(store.data.tasks).toHaveLength(0);
  });

  it("successful legacy text outputs remain compatible", async () => {
    const result = await exec("set_theme", { theme: "matrix" }, { id: "theme", intent: "Zmień motyw", tool: "set_theme" });
    expect(result.outcome.state).toBe("CONFIRMED");
    expect(store.settings.theme).toBe("matrix");
  });
});
