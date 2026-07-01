// === Wykonawca planu (agentRun) — testy ===
// Plan NIE jest tylko JSON-em: tu jest WYKONYWANY. Sprawdzamy plan liniowy, zależności, zgodę,
// odmowę, błąd kroku, nieznane narzędzie i ochronę przed zapętleniem — a na końcu REALNE wykonanie
// istniejącego narzędzia JARVIS-a (list_tasks) przez prawdziwy runTool. Zero płatnego API.
import { describe, it, expect, vi } from "vitest";
import { runPlan, topoOrder, makeDefaultExecTool, type RunDeps } from "../src/lib/agentRun";
import type { AgentPlan } from "../src/lib/agentPlanner";
import { confirmed, failed, attempted } from "../src/lib/actionOutcome";
import { runTool } from "../src/lib/tools";
import { riskOf } from "../src/lib/permissions";

const okExec = async () => ({ outcome: confirmed({ source: "mock" }), output: "ok" });
const baseDeps = (over: Partial<RunDeps> = {}): RunDeps => ({
  toolExists: () => true,
  riskOf: () => "read",
  execTool: okExec,
  ...over,
});

describe("agentRun — porządek i wykonanie", () => {
  it("topoOrder układa kroki wg dependsOn", () => {
    const order = topoOrder([
      { id: "b", intent: "B", dependsOn: ["a"] },
      { id: "a", intent: "A" },
      { id: "c", intent: "C", dependsOn: ["b"] },
    ]).map((s) => s.id);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("plan liniowy → wszystkie kroki potwierdzone (completed)", async () => {
    const plan: AgentPlan = { goal: "x", steps: [
      { id: "a", intent: "odczyt", tool: "list_tasks" },
      { id: "b", intent: "drugi odczyt", tool: "list_leads", dependsOn: ["a"] },
    ] };
    const r = await runPlan(plan, baseDeps());
    expect(r.status).toBe("completed");
    expect(r.steps.every((s) => s.outcome.state === "CONFIRMED")).toBe(true);
    expect(r.toolCalls).toBe(2);
  });

  it("krok zależny od FAILED poprzednika → pominięty (blocked, nie wykonany)", async () => {
    const execTool = vi.fn(async (name: string) => name === "list_tasks"
      ? { outcome: failed("błąd odczytu"), output: "err" }
      : { outcome: confirmed(), output: "ok" });
    const plan: AgentPlan = { goal: "x", steps: [
      { id: "a", intent: "odczyt", tool: "list_tasks" },
      { id: "b", intent: "zależny", tool: "list_leads", dependsOn: ["a"] },
    ] };
    const r = await runPlan(plan, baseDeps({ execTool }));
    expect(r.status).toBe("failed");
    const b = r.steps.find((s) => s.id === "b")!;
    expect(b.skipped).toBe(true);
    expect(execTool).toHaveBeenCalledTimes(1); // krok b NIE został wykonany
  });
});

describe("agentRun — zgoda na akcje zewnętrzne", () => {
  const outboundPlan: AgentPlan = { goal: "wyślij", steps: [
    { id: "s", intent: "wyślij maila", tool: "gmail_send", requiresConsent: true },
  ] };

  it("zgoda udzielona → krok wykonany", async () => {
    const requestConsent = vi.fn(async () => true);
    const execTool = vi.fn(okExec);
    const r = await runPlan(outboundPlan, baseDeps({ riskOf: () => "outbound", requestConsent, execTool }));
    expect(requestConsent).toHaveBeenCalledTimes(1);
    expect(execTool).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("completed");
  });

  it("zgoda odmówiona → krok pominięty, narzędzie NIE wykonane (blocked)", async () => {
    const requestConsent = vi.fn(async () => false);
    const execTool = vi.fn(okExec);
    const r = await runPlan(outboundPlan, baseDeps({ riskOf: () => "outbound", requestConsent, execTool }));
    expect(execTool).not.toHaveBeenCalled();
    expect(r.status).toBe("blocked");
    expect(r.steps[0].reason).toBe("brak zgody");
  });
});

describe("agentRun — odporność", () => {
  it("nieznane narzędzie → FAILED (model nie może go wymyślić)", async () => {
    const plan: AgentPlan = { goal: "x", steps: [{ id: "a", intent: "zła akcja", tool: "nieistnieje" }] };
    const r = await runPlan(plan, baseDeps({ toolExists: (n) => n !== "nieistnieje" }));
    expect(r.steps[0].outcome.state).toBe("FAILED");
    expect(r.status).toBe("failed");
  });

  it("błąd narzędzia (rzucony wyjątek) → FAILED, nie wywraca runu", async () => {
    const execTool = async () => { throw new Error("padło"); };
    const plan: AgentPlan = { goal: "x", steps: [{ id: "a", intent: "akcja", tool: "list_tasks" }] };
    const r = await runPlan(plan, baseDeps({ execTool }));
    expect(r.steps[0].outcome.state).toBe("FAILED");
  });

  it("limit wywołań narzędzi → zatrzymanie (anti-loop), reszta pominięta", async () => {
    const plan: AgentPlan = { goal: "x", steps: [
      { id: "a", intent: "1", tool: "list_tasks" },
      { id: "b", intent: "2", tool: "list_tasks" },
      { id: "c", intent: "3", tool: "list_tasks" },
    ] };
    const r = await runPlan(plan, baseDeps({ maxToolCalls: 2 }));
    expect(r.toolCalls).toBe(2);
    expect(r.status).toBe("stopped");
    expect(r.steps.find((s) => s.id === "c")?.skipped).toBe(true);
  });
});

describe("agentRun — wznowienie (seed): potwierdzone kroki nie wykonują się ponownie", () => {
  it("krok z seeda CONFIRMED jest pomijany; zależny dograny — bez podwójnego działania", async () => {
    const execTool = vi.fn(async () => ({ outcome: confirmed({ source: "mock" }), output: "ok" }));
    const plan: AgentPlan = { goal: "x", steps: [
      { id: "a", intent: "krok a", tool: "list_tasks" },
      { id: "b", intent: "krok b", tool: "list_leads", dependsOn: ["a"] },
    ] };
    const seed = [{ id: "a", intent: "krok a", tool: "list_tasks", outcome: confirmed({ message: "poprzednio" }) }];
    const r = await runPlan(plan, baseDeps({ execTool, seed }));
    expect(execTool).toHaveBeenCalledTimes(1); // tylko b — a NIE wykonane ponownie
    expect(r.steps.find((s) => s.id === "a")!.outcome.evidence?.message).toBe("poprzednio"); // wynik a zachowany
    expect(r.verdict.canClaimSuccess).toBe(true);
  });

  it("krok z seeda ATTEMPTED nie jest ponawiany (brak podwójnej wysyłki)", async () => {
    const execTool = vi.fn(okExec);
    const plan: AgentPlan = { goal: "wyślij", steps: [{ id: "a", intent: "mail", tool: "gmail_send", requiresConsent: true }] };
    const seed = [{ id: "a", intent: "mail", tool: "gmail_send", outcome: attempted("gmail") }];
    const r = await runPlan(plan, baseDeps({ riskOf: () => "outbound", execTool, seed }));
    expect(execTool).not.toHaveBeenCalled(); // ATTEMPTED → nie ponawiamy
    expect(r.verdict.canClaimSuccess).toBe(false);
  });
});

describe("agentRun — REALNE wykonanie istniejącego narzędzia", () => {
  it("plan z list_tasks wykonuje prawdziwe narzędzie przez runTool (read → bez zgody)", async () => {
    const plan: AgentPlan = { goal: "pokaż zadania", steps: [{ id: "a", intent: "lista zadań", tool: "list_tasks" }] };
    const exec = makeDefaultExecTool(runTool, riskOf);
    const r = await runPlan(plan, { toolExists: () => true, riskOf, execTool: exec });
    expect(r.status).toBe("completed");
    expect(r.steps[0].outcome.state).toBe("CONFIRMED");
    expect(typeof r.steps[0].output).toBe("string"); // realny string wyniku narzędzia
  });

  it("executeGoalPlan (kanoniczne wejście runtime) wykonuje realne narzędzie", async () => {
    const { executeGoalPlan } = await import("../src/lib/brain");
    const plan: AgentPlan = { goal: "pokaż zadania", steps: [{ id: "a", intent: "lista zadań", tool: "list_tasks" }] };
    const r = await executeGoalPlan(plan);
    expect(r.status).toBe("completed");
    expect(r.steps[0].outcome.state).toBe("CONFIRMED");
  });
});
