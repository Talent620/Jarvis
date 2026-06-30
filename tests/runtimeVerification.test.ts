// === Weryfikacja runtime: sukces TYLKO z dowodem ===
// JARVIS nigdy nie raportuje ukończenia celu, którego kryteria nie zostały spełnione. verifyRun
// rozróżnia 5 uczciwych stanów; canClaimSuccess=true wyłącznie, gdy WSZYSTKIE kroki CONFIRMED.
// Sprawdzamy też wpięcie do runPlan (werdykt w RunResult). Weryfikator NIE wykonuje narzędzi.
import { describe, it, expect } from "vitest";
import { verifyRun } from "../src/lib/resultVerifier";
import { runPlan, type RunDeps } from "../src/lib/agentRun";
import type { AgentPlan } from "../src/lib/agentPlanner";
import { confirmed, simulated, attempted, failed, draft, type ActionOutcome } from "../src/lib/actionOutcome";

const step = (id: string, outcome: ActionOutcome, skipped = false) => ({ id, intent: id, outcome, skipped });

describe("verifyRun — pięć uczciwych stanów", () => {
  it("pełny sukces: wszystkie CONFIRMED → confirmed + canClaimSuccess", () => {
    const v = verifyRun({ goal: "x", steps: [step("a", confirmed()), step("b", confirmed())] });
    expect(v.state).toBe("confirmed");
    expect(v.canClaimSuccess).toBe(true);
    expect(v.confirmed).toBe(2);
  });

  it("częściowe wykonanie (ATTEMPTED) → attempted, NIE wolno ogłaszać sukcesu", () => {
    const v = verifyRun({ goal: "x", steps: [step("a", confirmed()), step("b", attempted("gmail"))] });
    expect(v.state).toBe("attempted");
    expect(v.canClaimSuccess).toBe(false);
  });

  it("symulacja → simulated, nic nie wyszło na zewnątrz, brak sukcesu", () => {
    const v = verifyRun({ goal: "x", steps: [step("a", simulated())] });
    expect(v.state).toBe("simulated");
    expect(v.canClaimSuccess).toBe(false);
    expect(v.summary).toMatch(/NIC/);
  });

  it("brak odpowiedzi providera (ATTEMPTED bez potwierdzenia) → nigdy nie ogłasza sukcesu", () => {
    const v = verifyRun({ goal: "wyślij", steps: [step("a", attempted("smtp", "brak potwierdzenia dostarczenia"))] });
    expect(v.canClaimSuccess).toBe(false);
    expect(v.state).toBe("attempted");
  });

  it("błąd kroku → failed", () => {
    const v = verifyRun({ goal: "x", steps: [step("a", confirmed()), step("b", failed("padło"))] });
    expect(v.state).toBe("failed");
    expect(v.canClaimSuccess).toBe(false);
  });

  it("tylko szkice → prepared (przygotowano, nic na zewnątrz)", () => {
    const v = verifyRun({ goal: "x", steps: [step("a", draft())] });
    expect(v.state).toBe("prepared");
  });

  it("odporność: brakujący outcome nie wywraca weryfikatora", () => {
    // Weryfikator musi być odporny na niepełne dane (np. błąd wcześniejszego etapu).
    const v = verifyRun({ goal: "x", steps: [{ id: "a", outcome: undefined as unknown as ActionOutcome }] });
    expect(v.canClaimSuccess).toBe(false);
    expect(v.state).not.toBe("confirmed");
  });
});

describe("verifyRun — wpięcie do runPlan (werdykt w wyniku)", () => {
  const baseDeps = (over: Partial<RunDeps> = {}): RunDeps => ({
    toolExists: () => true,
    riskOf: () => "read",
    execTool: async () => ({ outcome: confirmed({ source: "mock" }), output: "ok" }),
    ...over,
  });

  it("plan w pełni potwierdzony → RunResult.verdict pozwala ogłosić sukces", async () => {
    const plan: AgentPlan = { goal: "x", steps: [{ id: "a", intent: "odczyt", tool: "list_tasks" }] };
    const r = await runPlan(plan, baseDeps());
    expect(r.verdict.canClaimSuccess).toBe(true);
    expect(r.summary).toBe(r.verdict.summary); // jedno źródło uczciwego statusu
  });

  it("outbound zakończony ATTEMPTED → werdykt NIE pozwala ogłosić sukcesu", async () => {
    const plan: AgentPlan = { goal: "wyślij", steps: [{ id: "a", intent: "mail", tool: "gmail_send" }] };
    const r = await runPlan(plan, baseDeps({ riskOf: () => "outbound", execTool: async () => ({ outcome: attempted("gmail") }) }));
    expect(r.verdict.canClaimSuccess).toBe(false);
    expect(r.verdict.state).toBe("attempted");
  });
});
