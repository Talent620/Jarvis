import { describe, it, expect } from "vitest";
import { parsePlan, currentStep } from "../src/lib/agentPlan";

describe("parsePlan — wyłuskanie kroków planu", () => {
  it("lista ponumerowana w wielu liniach", () => {
    const p = parsePlan("Plan:\n1. Otwórz stronę\n2) Wpisz imię\n3 - Potwierdź");
    expect(p).toEqual(["Otwórz stronę", "Wpisz imię", "Potwierdź"]);
  });
  it("plan w jednej linii", () => {
    expect(parsePlan("Plan: 1) raz 2) dwa 3) trzy")).toEqual(["raz", "dwa", "trzy"]);
  });
  it("tablica JSON", () => {
    expect(parsePlan('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });
  it("brak planu → []", () => {
    expect(parsePlan("po prostu zdanie bez planu")).toEqual([]);
    expect(parsePlan("")).toEqual([]);
  });
  it("ogranicza do 12 kroków", () => {
    const many = Array.from({ length: 20 }, (_, i) => `${i + 1}. krok`).join("\n");
    expect(parsePlan(many).length).toBeLessThanOrEqual(12);
  });
});

describe("currentStep — który krok trwa", () => {
  it("łapie „Krok N”", () => {
    expect(currentStep("Krok 2 z 4: wpisuję imię")).toBe(2);
    expect(currentStep("krok 3: gotowe")).toBe(3);
  });
  it("brak → 0", () => {
    expect(currentStep("robię coś")).toBe(0);
    expect(currentStep("")).toBe(0);
  });
});
