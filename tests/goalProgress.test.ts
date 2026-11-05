import { describe, expect, it } from "vitest";
import { formatGoalProgress, isGoalProgressRequest } from "../src/lib/goalProgress";
import { newGoal } from "../src/lib/goalState";

describe("wyniki zadania", () => {
  it("rozpoznaje krótką prośbę o częściowe wyniki", () => {
    expect(isGoalProgressRequest("JARVIS, pospiesz się. Potrzebuję pierwszych wyników!")).toBe(true);
    expect(isGoalProgressRequest("Pokaż wyniki")).toBe(true);
    expect(isGoalProgressRequest("Pokaż wyniki finansowe mojej firmy")).toBe(false);
  });
  it("pokazuje tylko zapisane wyniki i rozróżnia potwierdzenie", () => {
    const g = newGoal("ORION", { goal: "ORION", steps: [{ id: "a", intent: "pierwszy" }, { id: "b", intent: "drugi" }] }, "one", 1);
    g.results.a = { state: "ATTEMPTED", evidence: { message: "oczekuje" } };
    const report = formatGoalProgress([g]);
    expect(report).toContain("0/2");
    expect(report).toContain("oczekuje");
    expect(report).toContain("tempo wykonywania się nie zmieniło");
    expect(report).not.toContain("drugi:");
    expect(formatGoalProgress([])).toContain("Nie mam zapisanych zadań");
  });
});
