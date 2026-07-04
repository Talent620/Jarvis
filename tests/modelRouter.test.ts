import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyTask,
  needsDeepThink,
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
  it("zadanie matematyczne/ilościowe → complex (liczenie)", () => {
    expect(classifyTask("ile wynosi 17% z 240", false).kind).toBe("complex");
    expect(classifyTask("oblicz 128 * 47", false).kind).toBe("complex");
    expect(classifyTask("12 + 30 = ?", false).kind).toBe("complex");
  });
  it("logika/wnioskowanie → complex", () => {
    expect(classifyTask("rozwiąż ten sylogizm logiczny", false).kind).toBe("complex");
  });
  it("pytania WYJAŚNIAJĄCE/koncepcyjne → complex (mocniejszy model dla głębi)", () => {
    expect(classifyTask("jak działa fotosynteza?", false).kind).toBe("complex");
    expect(classifyTask("na czym polega teoria względności", false).kind).toBe("complex");
    expect(classifyTask("czym się różni HTTP od HTTPS", false).kind).toBe("complex");
    expect(classifyTask("w jaki sposób powstają czarne dziury", false).kind).toBe("complex");
    expect(classifyTask("co powoduje inflację", false).kind).toBe("complex");
  });
  it("krótkie pytania faktyczne dalej → simple (bez nadmiarowego routingu)", () => {
    expect(classifyTask("która godzina?", false).kind).toBe("simple");
    expect(classifyTask("jaka jest stolica Polski?", false).kind).toBe("simple");
    expect(classifyTask("jak masz na imię?", false).kind).toBe("simple");
  });
});

describe("modelRouter — needsDeepThink (kiedy myśleć głęboko)", () => {
  it("matematyka / kod / analiza / logika → tak", () => {
    expect(needsDeepThink("oblicz 17% z 240")).toBe(true);
    expect(needsDeepThink("zoptymalizuj ten algorytm")).toBe(true);
    expect(needsDeepThink("przeanalizuj i porównaj dwie strategie")).toBe(true);
    expect(needsDeepThink("udowodnij, że √2 jest niewymierne")).toBe(true);
  });
  it("zwykłe generowanie treści (mail/post/życzenia) → NIE (bez spowalniania)", () => {
    expect(needsDeepThink("napisz maila do Jana z podziękowaniem")).toBe(false);
    expect(needsDeepThink("ułóż życzenia urodzinowe")).toBe(false);
    expect(needsDeepThink("stwórz opis produktu")).toBe(false);
  });
  it("krótkie/proste → NIE; bardzo długie → tak", () => {
    expect(needsDeepThink("która godzina?")).toBe(false);
    expect(needsDeepThink("a".repeat(600))).toBe(true);
    expect(needsDeepThink("")).toBe(false);
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

  it("przycina dziennik do limitu (500 — większe okno dla statystyk routera Z12)", () => {
    for (let i = 0; i < 540; i++) {
      logRouteDecision({ provider: "groq", model: GROQ_SCOUT, kind: "simple", reason: String(i), fellBack: false });
    }
    expect(getRouteLog()).toHaveLength(500);
  });
});
