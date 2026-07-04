// === Panel stanu poznawczego (cognitiveStatus) — testy ===
// Autonomia ma być widoczna i kontrolowalna. Sprawdzamy: pusty stan, aktywny plan, oczekująca
// zgoda, błąd, zakończenie — oraz REDAKCJĘ (żadnych kluczy, promptów, podpisów myślenia).
import { describe, it, expect } from "vitest";
import { buildCognitiveStatus, redactSecret } from "../src/lib/cognitiveStatus";
import type { GoalRecord } from "../src/lib/goalState";
import type { RunResult, StepResult } from "../src/lib/agentRun";
import { confirmed, failed, draft } from "../src/lib/actionOutcome";
import type { AgentPlan } from "../src/lib/agentPlanner";

const plan: AgentPlan = { goal: "lead → mail", steps: [{ id: "a", intent: "znajdź leady", tool: "list_leads" }] };
const goal = (status: GoalRecord["status"]): GoalRecord => ({
  id: "g", goal: "Zwiększ przychód", plan, status, stepIndex: 0, correlationId: "g", results: {}, createdAt: 1, updatedAt: 1,
});
const step = (over: Partial<StepResult>): StepResult => ({ id: "a", intent: "krok", outcome: confirmed(), ...over });
const run = (steps: StepResult[]): RunResult => ({ status: "completed", steps, toolCalls: steps.length, summary: "", verdict: { state: "confirmed", canClaimSuccess: true, confirmed: 0, total: steps.length, summary: "", details: [] } });

describe("cognitiveStatus — redakcja sekretów", () => {
  it("ukrywa klucze API, Bearer i podpisy myślenia", () => {
    expect(redactSecret("klucz AIzaSyA1234567890abcdef")).toContain("[ukryte]");
    expect(redactSecret("Bearer abc.def.ghi token")).toContain("[ukryte]");
    expect(redactSecret("thoughtSignature=Xyz123")).toContain("[ukryte]");
    expect(redactSecret("zwykły tekst")).toBe("zwykły tekst");
  });
});

describe("cognitiveStatus — stany panelu", () => {
  it("pusty stan → brak celu, brak narzędzi, nie da się zatrzymać", () => {
    const v = buildCognitiveStatus({});
    expect(v.goal).toBeUndefined();
    expect(v.tools).toHaveLength(0);
    expect(v.canStop).toBe(false);
  });

  it("aktywny plan → cel, bieżący krok, narzędzia, można zatrzymać", () => {
    const v = buildCognitiveStatus({
      goal: goal("running"),
      run: run([step({ id: "a", intent: "znajdź leady", tool: "list_leads", outcome: confirmed() }), step({ id: "b", intent: "wyślij mail", tool: "gmail_send", outcome: draft() })]),
      model: "gemini-2.5-flash", provider: "Gemini", sources: ["lead:Firma X", "finanse"], confidence: 0.8,
    });
    expect(v.goal?.text).toBe("Zwiększ przychód");
    expect(v.currentStep).toBe("wyślij mail");        // pierwszy niepotwierdzony
    expect(v.tools).toContain("gmail_send");
    expect(v.lastConfirmed).toBe("znajdź leady");
    expect(v.canStop).toBe(true);
  });

  it("oczekująca zgoda → wymieniona w pendingConsents", () => {
    const v = buildCognitiveStatus({
      goal: goal("waiting_consent"),
      run: run([step({ id: "a", intent: "wyślij mail", tool: "gmail_send", outcome: draft("brak zgody"), skipped: true, reason: "brak zgody" })]),
    });
    expect(v.pendingConsents).toContain("wyślij mail");
  });

  it("błąd → nie udaje sukcesu (brak lastConfirmed dla nieudanego)", () => {
    const v = buildCognitiveStatus({ goal: goal("failed"), run: run([step({ id: "a", intent: "akcja", tool: "x", outcome: failed("padło") })]) });
    expect(v.lastConfirmed).toBeUndefined();
  });

  it("zakończenie → ostatni potwierdzony rezultat widoczny, celu nie można już zatrzymać", () => {
    const v = buildCognitiveStatus({ goal: goal("completed"), run: run([step({ id: "a", intent: "domknięto projekt", outcome: confirmed() })]) });
    expect(v.lastConfirmed).toBe("domknięto projekt");
    expect(v.canStop).toBe(false);
  });
});
