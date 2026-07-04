import { describe, it, expect } from "vitest";
import { intelForModel, intelColor } from "../src/lib/modelIntel";

describe("intelForModel — poziom inteligencji (IQ%)", () => {
  it("auto / pusty → 0 (nic do pokazania)", () => {
    expect(intelForModel("auto").iq).toBe(0);
    expect(intelForModel("").iq).toBe(0);
  });

  it("dokładne wpisy z katalogu mają opis oficjalny i potoczny", () => {
    const opus = intelForModel("claude-opus-4-8");
    expect(opus.iq).toBeGreaterThanOrEqual(95);
    expect(opus.official.length).toBeGreaterThan(0);
    expect(opus.casual.length).toBeGreaterThan(0);
  });

  it("Opus > Sonnet > Haiku (sensowny porządek w rodzinie)", () => {
    expect(intelForModel("claude-opus-4-8").iq).toBeGreaterThan(intelForModel("claude-sonnet-4-6").iq);
    expect(intelForModel("claude-sonnet-4-6").iq).toBeGreaterThan(intelForModel("claude-haiku-4-5").iq);
  });

  it("nieznany model → zgrubne dopasowanie po nazwie (zawsze 0<iq≤100)", () => {
    const r = intelForModel("some-llama-70b-custom");
    expect(r.iq).toBeGreaterThan(0);
    expect(r.iq).toBeLessThanOrEqual(100);
    expect(r.official).toBeTruthy();
    const mini = intelForModel("tiny-mini-1.5b");
    expect(mini.iq).toBeLessThan(r.iq); // malutki niżej niż 70B
  });

  it("każdy wynik mieści się w 0–100", () => {
    for (const m of ["claude-opus-4-8", "gemini-2.5-pro", "mistral-small-latest", "llama-3.1-8b-instant", "cos-nieznanego"]) {
      const { iq } = intelForModel(m);
      expect(iq).toBeGreaterThanOrEqual(0);
      expect(iq).toBeLessThanOrEqual(100);
    }
  });
});

describe("intelColor — zielony dla czołówki, niżej chłodniej/cieplej", () => {
  it("wysokie = zielone, niskie ≠ zielone", () => {
    expect(intelColor(99)).toBe("#2fbf71");
    expect(intelColor(60)).not.toBe("#2fbf71");
  });
});
