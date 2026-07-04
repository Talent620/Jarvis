// === Rada Strategiczna (decisionEngine) — testy ===
// JARVIS kwestionuje własny pierwszy pomysł, zanim doradzi. Sprawdzamy: kiedy Rada się uruchamia
// (tryby inteligencji + stawka), syntezę Sędziego, sprzeczne propozycje, jeden dostępny model,
// limit API (degradacja). Zero prawdziwego API — runner jest mockiem.
import { describe, it, expect, vi } from "vitest";
import {
  shouldRunDecisionCouncil, isHighStakes, inferReversibility, runDecisionCouncil,
  parseDecision, type DecisionInput, type RoleRunner,
} from "../src/lib/decisionEngine";

const reversibleQ: DecisionInput = { question: "Czy zmienić kolor przycisku CTA?", reversible: true };
const bigExpenseQ: DecisionInput = { question: "Czy kupić reklamę za 5000 zł?", amount: 5000 };
const irreversibleQ: DecisionInput = { question: "Czy wyślij ofertę do całej bazy?" };

describe("decisionEngine — kiedy uruchamiać Radę", () => {
  it("economy → nigdy (nawet ręcznie nie auto); balanced → tylko na żądanie", () => {
    expect(shouldRunDecisionCouncil({ mode: "economy", input: bigExpenseQ })).toBe(false);
    expect(shouldRunDecisionCouncil({ mode: "balanced", input: bigExpenseQ })).toBe(false);
    expect(shouldRunDecisionCouncil({ mode: "balanced", input: bigExpenseQ, manual: true })).toBe(true);
  });

  it("maximum → auto dla wysokiej stawki, ale nie dla błahej odwracalnej decyzji", () => {
    expect(shouldRunDecisionCouncil({ mode: "maximum", input: bigExpenseQ })).toBe(true);
    expect(shouldRunDecisionCouncil({ mode: "maximum", input: reversibleQ })).toBe(false);
  });

  it("stawka: duży wydatek i nieodwracalność → high", () => {
    expect(isHighStakes(bigExpenseQ)).toBe(true);
    expect(isHighStakes(irreversibleQ)).toBe(true);
    expect(isHighStakes(reversibleQ)).toBe(false);
  });

  it("odwracalność: jawna flaga i wykrycie z treści", () => {
    expect(inferReversibility(reversibleQ)).toBe("reversible");
    expect(inferReversibility({ question: "usuń konto klienta" })).toBe("hard_to_reverse");
  });
});

describe("decisionEngine — przebieg Strateg/Krytyk/Sędzia", () => {
  it("trzy role → ustrukturyzowana rekomendacja od Sędziego", async () => {
    const calls: string[] = [];
    const runner: RoleRunner = async (role) => {
      calls.push(role);
      if (role === "strateg") return "Proponuję wariant A.";
      if (role === "krytyk") return "Ryzyko: A jest drogie.";
      return JSON.stringify({
        recommendation: "Wariant A, ale taniej (B jako zabezpieczenie).",
        alternatives: ["Wariant B"], risks: ["koszt"], reversibility: "reversible",
        firstSafeStep: "Zrób mały test wariantu A.", confidence: 0.8,
      });
    };
    const d = await runDecisionCouncil(bigExpenseQ, runner);
    expect(calls).toEqual(["strateg", "krytyk", "sedzia"]); // kwestionuje własny pomysł
    expect(d.recommendation).toMatch(/Wariant A/);
    expect(d.ranBy).toContain("sedzia");
    expect(d.firstSafeStep).toMatch(/test/i);
  });

  it("sprzeczne propozycje → Sędzia wybiera/łączy (jego werdykt wygrywa)", async () => {
    const runner: RoleRunner = async (role) => {
      if (role === "strateg") return "Podnieś cenę.";
      if (role === "krytyk") return "Nie podnoś — stracisz klientów.";
      return JSON.stringify({ recommendation: "Podnieś cenę tylko nowym klientom.", firstSafeStep: "Pilotaż na 10% bazy.", confidence: 0.7 });
    };
    const d = await runDecisionCouncil({ question: "Czy podnieść ceny?" }, runner);
    expect(d.recommendation).toMatch(/nowym klientom/i);
  });

  it("tylko jeden model (Krytyk i Sędzia milczą) → degraduje, ale wciąż doradza", async () => {
    const runner: RoleRunner = async (role) => (role === "strateg" ? "Zrób X." : null);
    const d = await runDecisionCouncil({ question: "Co zrobić?" }, runner);
    expect(d.ranBy).toEqual(["strateg"]);
    expect(d.recommendation).toMatch(/Zrób X/);
    expect(d.confidence).toBeLessThan(0.6);
  });

  it("limit API / brak modelu (Strateg milczy) → uczciwy fallback, bez zmyślania", async () => {
    const runner: RoleRunner = vi.fn(async () => null);
    const d = await runDecisionCouncil(irreversibleQ, runner);
    expect(d.ranBy).toEqual([]);
    expect(d.confidence).toBeLessThanOrEqual(0.3);
    expect(d.firstSafeStep).toMatch(/odwracaln/i);
  });
});

describe("decisionEngine — parsowanie Sędziego", () => {
  it("niepełny JSON Sędziego → bezpieczne domyślne (firstSafeStep zawsze jest)", () => {
    const d = parseDecision('{"recommendation":"Zrób A"}', { question: "?" }, ["strateg", "sedzia"]);
    expect(d?.firstSafeStep).toBeTruthy();
    expect(d?.confidence).toBeGreaterThan(0);
  });

  it("brak JSON → null (caller użyje fallbacku Stratega)", () => {
    expect(parseDecision("bez json", { question: "?" }, [])).toBeNull();
  });
});
