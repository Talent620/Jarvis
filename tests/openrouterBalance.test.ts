import { describe, it, expect } from "vitest";
import { parseCredits, isLowBalance } from "../src/lib/openrouterBalance";

describe("openrouterBalance — parseCredits", () => {
  it("liczy pozostałe środki z total - usage", () => {
    expect(parseCredits({ data: { total_credits: 10, total_usage: 3.5 } })).toEqual({
      total: 10,
      usage: 3.5,
      remaining: 6.5,
    });
  });

  it("zwraca null przy braku/niepełnych danych", () => {
    expect(parseCredits(null)).toBeNull();
    expect(parseCredits({})).toBeNull();
    expect(parseCredits({ data: { total_credits: 10 } })).toBeNull();
    expect(parseCredits({ data: { total_credits: "x", total_usage: 1 } })).toBeNull();
  });
});

describe("openrouterBalance — isLowBalance", () => {
  it("alert tylko gdy próg > 0 i saldo ≤ próg", () => {
    expect(isLowBalance(0.5, 1)).toBe(true);
    expect(isLowBalance(1, 1)).toBe(true);
    expect(isLowBalance(2, 1)).toBe(false);
    expect(isLowBalance(0.5, 0)).toBe(false); // próg 0 = wyłączony
  });
});
