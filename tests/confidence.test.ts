import { describe, it, expect } from "vitest";
import { estimateConfidence, isLowConfidence } from "../src/lib/confidence";

describe("confidence — estimateConfidence", () => {
  it("pewna, konkretna odpowiedź → wysoka pewność", () => {
    expect(estimateConfidence("Stolicą Polski jest Warszawa.", "simple")).toBeGreaterThanOrEqual(0.7);
  });

  it("pustka → 0", () => {
    expect(estimateConfidence("", "simple")).toBe(0);
    expect(estimateConfidence("   ", "complex")).toBe(0);
  });

  it("markery wahania obniżają pewność", () => {
    const conf = estimateConfidence("Chyba nie jestem pewien, ale wydaje mi się że tak.", "simple");
    expect(conf).toBeLessThan(0.55);
  });

  it("odmowa obniża pewność", () => {
    const conf = estimateConfidence("Przepraszam, ale nie mogę pomóc z tym pytaniem jako model AI.", "simple");
    expect(conf).toBeLessThan(0.55);
  });

  it("za krótka odpowiedź na pytanie complex → niska", () => {
    expect(estimateConfidence("Tak.", "complex")).toBeLessThan(0.55);
  });

  it("degeneracja (powtórzony token) obniża pewność", () => {
    const conf = estimateConfidence("wynik wynik wynik wynik to liczba", "simple");
    expect(conf).toBeLessThan(0.8);
  });

  it("wynik jest zawsze w zakresie 0..1", () => {
    const c = estimateConfidence("nie wiem nie wiem nie wiem, nie mogę, jako model AI", "complex");
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});

describe("confidence — isLowConfidence", () => {
  it("poniżej progu = true; próg 0 wyłącza bramę", () => {
    expect(isLowConfidence(0.4, 0.55)).toBe(true);
    expect(isLowConfidence(0.6, 0.55)).toBe(false);
    expect(isLowConfidence(0.1, 0)).toBe(false); // próg 0 = brama off
  });
});
