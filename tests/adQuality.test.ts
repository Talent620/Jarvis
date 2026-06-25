import { describe, it, expect } from "vitest";
import { scoreAdCopy, adQualityLabel, listItemsUnder } from "../src/lib/adQuality";

describe("adQuality — listItemsUnder", () => {
  it("wyłuskuje pozycje listy pod nagłówkiem i kończy na kolejnej sekcji", () => {
    const txt = [
      "NAGŁÓWKI:",
      "1. Strony WWW dla firm",
      "2. Tania strona w 3 dni",
      "- Sklep online od ręki",
      "",
      "OPISY:",
      "1. Coś tam długiego",
    ].join("\n");
    const heads = listItemsUnder(txt, /nag[łl][óo]w(ek|ki)/i);
    expect(heads).toContain("Strony WWW dla firm");
    expect(heads).toContain("Tania strona w 3 dni");
    expect(heads).toContain("Sklep online od ręki");
    expect(heads).not.toContain("Coś tam długiego"); // już z sekcji OPISY
  });
});

describe("adQuality — scoreAdCopy", () => {
  it("pusty tekst → 0 i wysokie ryzyko", () => {
    const q = scoreAdCopy("google", "");
    expect(q.score).toBe(0);
    expect(q.risk).toBe("high");
  });

  it("flaguje nagłówki ponad limit 30 znaków (Google)", () => {
    const txt = [
      "NAGŁÓWKI:",
      "1. Krótki nagłówek",
      "2. Ten nagłówek jest zdecydowanie o wiele za długi na Google Ads",
      "3. Jeszcze jeden ok",
      "OPISY:",
      "1. opis",
    ].join("\n");
    const q = scoreAdCopy("google", txt);
    expect(q.issues.some((i) => /limit 30/.test(i))).toBe(true);
  });

  it("flaguje KAPITALIKI, nadmiar wykrzykników, ryzykowne zwroty i emoji (Google)", () => {
    const txt = "TANIO SZYBKO MOCNO!!! Gwarantujemy najlepszy na rynku efekt 🚀🔥";
    const q = scoreAdCopy("google", txt);
    expect(q.issues.some((i) => /KAPITALIK/i.test(i))).toBe(true);
    expect(q.issues.some((i) => /wykrzyknik/i.test(i))).toBe(true);
    expect(q.issues.some((i) => /Ryzykowne/i.test(i))).toBe(true);
    expect(q.issues.some((i) => /Emoji/i.test(i))).toBe(true);
    expect(q.risk).toBe("high");
  });

  it("nagradza obecność CTA i nie krzyczy o akronimy", () => {
    const txt = "Profesjonalne strony WWW dla firm B2B i sklepów. Zadzwoń i wyceń projekt jeszcze dziś.";
    const q = scoreAdCopy("meta", txt);
    expect(q.wins.some((w) => /CTA/.test(w))).toBe(true);
    expect(q.issues.some((i) => /KAPITALIK/i.test(i))).toBe(false); // B2B = akronim, nie krzyk
    expect(q.score).toBeGreaterThanOrEqual(80);
  });

  it("emoji w Meta NIE jest błędem (dozwolone)", () => {
    const q = scoreAdCopy("meta", "Sprawdź naszą ofertę 🚀 i zamów dziś.");
    expect(q.issues.some((i) => /Emoji/i.test(i))).toBe(false);
  });

  it("brak CTA → issue", () => {
    const q = scoreAdCopy("google", "Strony internetowe dla lokalnych firm w dobrej cenie.");
    expect(q.issues.some((i) => /CTA/.test(i))).toBe(true);
  });

  it("adQualityLabel zawiera wynik i poziom ryzyka", () => {
    const q = scoreAdCopy("google", "Zadzwoń i sprawdź naszą ofertę stron dla firm.");
    expect(adQualityLabel(q)).toMatch(/Jakość reklamy: \d+\/100/);
    expect(adQualityLabel(q)).toMatch(/ryzyko/);
  });
});
