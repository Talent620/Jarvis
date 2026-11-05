import { describe, expect, it, vi } from "vitest";
import { runPlan, makeDefaultExecTool, type RunDeps } from "../src/lib/agentRun";
import { confirmed } from "../src/lib/actionOutcome";
import { loadGoals, newGoal, upsertGoal, type GoalStorage } from "../src/lib/goalState";
import { startAndRunGoal } from "../src/lib/goalRuntime";
import { classifyError, decideRecovery } from "../src/lib/recoveryPolicy";
import { parseQueuePlan } from "../src/lib/goalQueue";
import { workspaceAgentTools } from "../src/lib/workspaceAgentTools";

const plan = { goal: "Sprawdź zadania", steps: [{ id: "a", intent: "Odczytaj", tool: "list_tasks" }] };
const deps = (overrides: Partial<RunDeps> = {}): RunDeps => ({ toolExists: () => true, riskOf: () => "read", execTool: async () => ({ outcome: confirmed(), output: "ok" }), ...overrides });
const memory = (): GoalStorage => {
  let data: unknown = null;
  return { get: async <T>() => structuredClone(data) as T, set: async (_key, value) => { data = structuredClone(value); return true; } };
};

describe("autonomia — rzeczywisty wynik i wznowienie", () => {
  it("nie uznaje komunikatu błędu ani ok:false za sukces", async () => {
    for (const output of ['Błąd narzędzia list_tasks: brak konfiguracji', '{"ok":false,"error":"command failed"}']) {
      const result = await runPlan(plan, deps({ execTool: makeDefaultExecTool(async () => output, () => "read") }));
      expect(result.verdict.canClaimSuccess).toBe(false);
      expect(result.status).toBe("failed");
    }
  });
  it("ponawia chwilowy błąd odczytu i zachowuje końcowy wynik", async () => {
    const tool = vi.fn().mockResolvedValueOnce("Błąd narzędzia: fetch failed").mockResolvedValue("lista zadań");
    const result = await runPlan(plan, deps({ execTool: makeDefaultExecTool(tool, () => "read"), recover: (e, risk, attempt) => decideRecovery({ kind: classifyError(e), risk, attempt }), sleep: async () => {} }));
    expect(tool).toHaveBeenCalledTimes(2);
    expect(result.verdict.canClaimSuccess).toBe(true);
  });
  it("limit etapów zachowuje pozostałe kroki i nie ogłasza ukończenia", async () => {
    const result = await runPlan({ ...plan, steps: [...plan.steps, { id: "b", intent: "Kolejny", tool: "list_tasks" }] }, deps({ maxSteps: 1 }));
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].skipped).toBe(true);
    expect(result.verdict.canClaimSuccess).toBe(false);
  });
  it("pauza zatrzymuje następne narzędzie", async () => {
    let stop = false;
    const tool = vi.fn(async () => { stop = true; return { outcome: confirmed(), output: "gotowe" }; });
    const result = await runPlan({ ...plan, steps: [...plan.steps, { id: "b", intent: "Kolejny", tool: "list_tasks" }] }, deps({ execTool: tool, shouldStop: () => stop }));
    expect(tool).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("stopped");
  });
  it("przekazuje prawdziwy wynik kroku jako argument kolejnego", async () => {
    const tool = vi.fn(async (_name, args) => ({ outcome: confirmed(), output: args?.content || '{"content":"kod z poprzedniego kroku"}' }));
    const result = await runPlan({ ...plan, steps: [...plan.steps, { id: "b", intent: "Zapis", tool: "workspace_write", dependsOn: ["a"], arguments: { content: { $result: "a", path: "content" } } }] }, deps({ execTool: tool }));
    expect(result.steps[1].output).toBe("kod z poprzedniego kroku");
  });
  it("nie potwierdza analizy, której nikt nie wykonał", async () => {
    const result = await runPlan({ goal: "Analiza", steps: [{ id: "a", intent: "Policz" }] }, deps());
    expect(result.verdict.canClaimSuccess).toBe(false);
  });
  it("błąd zapisu kolejki blokuje wykonanie", async () => {
    await expect(startAndRunGoal({ goal: plan.goal, plan, correlationId: "no-storage", now: Date.now() }, { get: async () => null, set: async () => false })).rejects.toThrow(/zapisać kolejki/);
  });
  it("równoczesne dodania nie gubią zadań", async () => {
    const storage = memory();
    await Promise.all([upsertGoal(newGoal("a", plan, "a", 1), storage), upsertGoal(newGoal("b", plan, "b", 2), storage)]);
    expect((await loadGoals(storage)).map((g) => g.id).sort()).toEqual(["a", "b"]);
  });
  it("ponowne uruchomienie tego samego celu zachowuje potwierdzone wyniki", async () => {
    const storage = memory();
    const input = { goal: plan.goal, plan, correlationId: "once", now: Date.now() };
    const first = await startAndRunGoal(input, storage);
    const second = await startAndRunGoal(input, storage);
    expect(second.result.toolCalls).toBe(0);
    expect(second.record.results).toEqual(first.record.results);
  });
  it("plan odrzuca wymyślone narzędzia i cykle", () => {
    expect(() => parseQueuePlan(JSON.stringify({ ...plan, steps: [{ id: "a", intent: "x", tool: "imaginary" }] }))).toThrow(/Nieznane/);
    expect(() => parseQueuePlan(JSON.stringify({ ...plan, steps: [{ ...plan.steps[0], dependsOn: ["a"] }] }))).toThrow(/Cykl/);
  });
  it("kod wyjścia terminala jest dowodem wykonania polecenia", async () => {
    const terminal = { goal: "Test", steps: [{ id: "a", intent: "Uruchom test", tool: "workspace_terminal" }] };
    const result = await runPlan(terminal, deps({ riskOf: () => "outbound", execTool: makeDefaultExecTool(async () => '{"ok":true,"code":0,"stdout":"PASS"}', () => "outbound") }));
    expect(result.verdict.canClaimSuccess).toBe(true);
    expect(result.steps[0].output).toContain("PASS");
  });
  it("most plików ma dostępne narzędzia i czytelny błąd bez desktopu", async () => {
    expect(workspaceAgentTools.map((t) => t.def.name)).toContain("workspace_terminal");
    expect(JSON.parse(await workspaceAgentTools[0].run({}))).toMatchObject({ ok: false });
  });
});
