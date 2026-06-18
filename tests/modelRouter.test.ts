import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyTask,
  groqModelFor,
  GROQ_SCOUT,
  GROQ_KIMI,
  logRouteDecision,
  getRouteLog,
  clearRouteLog,
} from "../src/lib/modelRouter";

describe("modelRouter — klasyfikacja zadania", () => {
  it("obraz → vision", () => {
    expect(classifyTask("co to?", true).kind).toBe("vision");
  });
  it("proste, krótkie zapytanie → simple", () => {
    expect(classifyTask("która godzina?", false).kind).toBe("simple");
  });
  it("zadanie wymagające rozumowania (kod/analiza) → complex", () => {
    expect(classifyTask("napisz kod sortujący i zoptymalizuj", false).kind).toBe("complex");
    expect(classifyTask("przeanalizuj i porównaj dwie strategie", false).kind).toBe("complex");
  });
  it("bardzo długie zapytanie → complex", () => {
    expect(classifyTask("a".repeat(700), false).kind).toBe("complex");
  });
});

describe("modelRouter — Groq Scout vs Kimi", () => {
  it("złożone → Kimi K2", () => {
    expect(groqModelFor("complex")).toBe(GROQ_KIMI);
  });
  it("proste i wizyjne → Scout (multimodalny)", () => {
    expect(groqModelFor("simple")).toBe(GROQ_SCOUT);
    expect(groqModelFor("vision")).toBe(GROQ_SCOUT);
  });
});

describe("modelRouter — dziennik decyzji", () => {
  beforeEach(() => clearRouteLog());

  it("zapisuje decyzję i zwraca najnowsze pierwsze", () => {
    logRouteDecision({ provider: "groq", model: GROQ_SCOUT, kind: "simple", reason: "x", fellBack: false });
    logRouteDecision({ provider: "groq", model: GROQ_KIMI, kind: "complex", reason: "y", fellBack: true });
    const log = getRouteLog();
    expect(log).toHaveLength(2);
    expect(log[0].model).toBe(GROQ_KIMI);
    expect(log[0].fellBack).toBe(true);
    expect(typeof log[0].at).toBe("number");
  });

  it("przycina do 100 wpisów", () => {
    for (let i = 0; i < 120; i++) {
      logRouteDecision({ provider: "groq", model: GROQ_SCOUT, kind: "simple", reason: String(i), fellBack: false });
    }
    expect(getRouteLog()).toHaveLength(100);
  });
});
