import { describe, it, expect } from "vitest";
import { PROBES, scoreProbe, runIqProbe, verdict } from "../src/lib/iqProbe";

// Poprawne odpowiedzi dla każdego zadania (do sterowania atrapą modelu).
const RIGHT: Record<string, string> = {
  mnozenie: "391",
  ciag: "32",
  logika: "Nie.",
  polecenie: "BANAN",
  kolejnosc: "Ewa",
  pierwsza: "nie",
};

describe("scoreProbe — deterministyczna ocena pojedynczego zadania", () => {
  it("zalicza poprawne, odrzuca błędne i puste", () => {
    for (const p of PROBES) {
      expect(scoreProbe(p, RIGHT[p.id])).toBe(true);
      expect(scoreProbe(p, "")).toBe(false);
    }
  });

  it("toleruje obudowę odpowiedzi (np. „Odpowiedź: nie.”, „= 391”)", () => {
    const logika = PROBES.find((p) => p.id === "logika")!;
    expect(scoreProbe(logika, "Odpowiedź: nie, to nie wynika logicznie.")).toBe(true);
    const mn = PROBES.find((p) => p.id === "mnozenie")!;
    expect(scoreProbe(mn, "17 × 23 = 391")).toBe(true);
  });

  it("polecenie BANAN: tylko czyste słowo (z kropką też), nie zdanie", () => {
    const p = PROBES.find((x) => x.id === "polecenie")!;
    expect(scoreProbe(p, "BANAN.")).toBe(true);
    expect(scoreProbe(p, "Proszę: banan w zdaniu")).toBe(false);
  });
});

describe("runIqProbe — pełen przebieg z atrapą modelu", () => {
  it("model idealny → 100%", async () => {
    const r = await runIqProbe(async (prompt) => {
      const p = PROBES.find((x) => x.prompt === prompt)!;
      return RIGHT[p.id];
    });
    expect(r.correct).toBe(PROBES.length);
    expect(r.pct).toBe(100);
    expect(r.total).toBe(PROBES.length);
  });

  it("model milczący → 0%, nie rzuca", async () => {
    const r = await runIqProbe(async () => "");
    expect(r.pct).toBe(0);
  });

  it("błąd wywołania pojedynczego zadania = niezaliczone (nie wysadza testu)", async () => {
    const r = await runIqProbe(async () => { throw new Error("network"); });
    expect(r.correct).toBe(0);
    expect(r.perProbe?.every((x) => !x.ok)).toBe(true);
  });
});

describe("verdict — werdykt łączy trafność i szybkość", () => {
  it("wysokie + szybkie → pewniak; wysokie + wolne → bystry ale wolniejszy", () => {
    expect(verdict(95, 1000)).toMatch(/pewniak/i);
    expect(verdict(95, 5000)).toMatch(/wolniejsz/i);
  });
  it("niskie → ostrzeżenie", () => {
    expect(verdict(30, 1000)).toMatch(/słaby|najprostsz/i);
  });
});
