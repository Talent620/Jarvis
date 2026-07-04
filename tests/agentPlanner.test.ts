import { describe, it, expect } from "vitest";
import { validatePlan, hasDependencyCycle, looksMultiStep, type AgentPlan } from "../src/lib/agentPlanner";
import type { Risk } from "../src/lib/permissions";

const TOOLS = new Set(["find_leads", "lead_dossier", "gmail_send", "add_task"]);
const toolExists = (n: string) => TOOLS.has(n);
const riskOf = (n: string): Risk => (n === "gmail_send" ? "outbound" : n === "find_leads" ? "read" : "write");

const plan = (over: Partial<AgentPlan>): AgentPlan => ({ goal: "Cel", steps: [], ...over });

describe("agentPlanner — validatePlan (poprawny JSON ≠ poprawny plan)", () => {
  it("plan liniowy z prawdziwymi narzędziami → ok", () => {
    const v = validatePlan(plan({ steps: [
      { id: "s1", intent: "znajdź leady", tool: "find_leads" },
      { id: "s2", intent: "teczka", tool: "lead_dossier", dependsOn: ["s1"] },
    ] }), { toolExists, riskOf });
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("nieznane narzędzie → błąd (model nie może go wymyślić)", () => {
    const v = validatePlan(plan({ steps: [{ id: "s1", intent: "x", tool: "magic_tool" }] }), { toolExists, riskOf });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/Nieznane narzędzie/);
  });

  it("narzędzie outbound bez requiresConsent → błąd (nie da się ominąć zgody)", () => {
    const v = validatePlan(plan({ steps: [{ id: "s1", intent: "wyślij", tool: "gmail_send" }] }), { toolExists, riskOf });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/zgoda jest obowiązkowa/);
    // z requiresConsent=true przechodzi
    const ok = validatePlan(plan({ steps: [{ id: "s1", intent: "wyślij", tool: "gmail_send", requiresConsent: true }] }), { toolExists, riskOf });
    expect(ok.ok).toBe(true);
  });

  it("cykl zależności → błąd", () => {
    const v = validatePlan(plan({ steps: [
      { id: "a", intent: "x", dependsOn: ["b"] },
      { id: "b", intent: "y", dependsOn: ["a"] },
    ] }), { toolExists, riskOf });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/Cykl/);
  });

  it("dependsOn na nieistniejący krok → błąd", () => {
    const v = validatePlan(plan({ steps: [{ id: "a", intent: "x", dependsOn: ["zzz"] }] }), { toolExists, riskOf });
    expect(v.errors.join(" ")).toMatch(/nieistniejącego/);
  });

  it("brak krytycznej informacji (gdy reszta ok) → jedno konkretne pytanie", () => {
    const v = validatePlan(plan({
      steps: [{ id: "s1", intent: "wyślij ofertę", tool: "add_task" }],
      missingInformation: ["Do której firmy wysłać ofertę?"],
    }), { toolExists, riskOf });
    expect(v.ok).toBe(true);
    expect(v.question).toBe("Do której firmy wysłać ofertę?");
  });

  it("pusty plan / brak celu → błędy", () => {
    expect(validatePlan(plan({ steps: [] }), { toolExists, riskOf }).ok).toBe(false);
    expect(validatePlan(plan({ goal: "", steps: [{ id: "s1", intent: "x" }] }), { toolExists, riskOf }).ok).toBe(false);
  });
});

describe("agentPlanner — pomocnicze", () => {
  it("hasDependencyCycle wykrywa i przepuszcza DAG", () => {
    expect(hasDependencyCycle([{ id: "a", intent: "" }, { id: "b", intent: "", dependsOn: ["a"] }])).toBe(false);
    expect(hasDependencyCycle([{ id: "a", intent: "", dependsOn: ["a"] }])).toBe(true);
  });

  it("looksMultiStep: wielo-akcyjne polecenie tak, proste nie", () => {
    expect(looksMultiStep("znajdź leady i przygotuj ofertę oraz wyślij maila")).toBe(true);
    expect(looksMultiStep("cześć")).toBe(false);
    expect(looksMultiStep("jaka pogoda")).toBe(false);
  });
});
