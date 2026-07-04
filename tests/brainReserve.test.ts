import { describe, it, expect } from "vitest";
import { auxiliaryAllowed, auxiliaryCap } from "../src/lib/brainReserve";

describe("brainReserve — rezerwa głównego API dla mózgu", () => {
  it("bez budżetu (0) → brak ograniczeń (zawsze dozwolone)", () => {
    expect(auxiliaryAllowed(999, 0, 35)).toBe(true);
  });

  it("przy 35% rezerwy próg pomocniczych = 65% budżetu", () => {
    expect(auxiliaryCap(100, 35)).toBeCloseTo(65, 6);
    expect(auxiliaryAllowed(64, 100, 35)).toBe(true);   // poniżej progu
    expect(auxiliaryAllowed(65, 100, 35)).toBe(false);  // na progu → rezerwa
    expect(auxiliaryAllowed(80, 100, 35)).toBe(false);  // w rezerwie
  });

  it("1/3 (≈33%) zostaje dla mózgu przy domyślnych 35%", () => {
    const budget = 30;
    // pomocnicze wolno wydać do 65% = 19.5; reszta (≥35% ≈ 10.5) chroniona dla mózgu
    expect(auxiliaryAllowed(19, budget, 35)).toBe(true);
    expect(auxiliaryAllowed(20, budget, 35)).toBe(false);
  });

  it("rezerwa przycięta do 0–90%", () => {
    expect(auxiliaryCap(100, 200)).toBeCloseTo(10, 6); // 90% rezerwy max → 10% dla pomocniczych
    expect(auxiliaryCap(100, -5)).toBeCloseTo(100, 6); // <0 → 0% rezerwy
  });
});
