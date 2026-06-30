import { describe, it, expect } from "vitest";
import { curateContext, scoreCandidate, contextBudgetChars, type ContextItem } from "../src/lib/contextCurator";

const NOW = new Date("2026-06-30T12:00:00").getTime();
const DAY = 86_400_000;
const item = (over: Partial<ContextItem>): ContextItem => ({ text: "", source: "pamięć", at: NOW, ...over });

describe("contextCurator — curateContext (trafność > ilość)", () => {
  it("nowszy fakt o tym samym temacie wygrywa, a sprzeczność jest ZAZNACZONA", () => {
    const r = curateContext([
      item({ text: "Klient woli telefon", key: "kontakt:FirmaX", at: NOW - 30 * DAY }),
      item({ text: "Klient woli e-mail", key: "kontakt:FirmaX", at: NOW - 1 * DAY }),
    ], { query: "jak kontaktować klienta", now: NOW, budgetChars: 1000 });
    expect(r.items.map((i) => i.text)).toEqual(["Klient woli e-mail"]); // najnowszy
    expect(r.contradictions.length).toBe(1); // sprzeczność oznaczona, nie zgadnięta po cichu
    expect(r.contradictions[0].key).toBe("kontakt:FirmaX");
  });

  it("trafność do zapytania podnosi ocenę (niepowiązana pamięć spada)", () => {
    const rel = item({ text: "Faktura dla Firma X na 8000 zł, termin płatności" });
    const irrel = item({ text: "Ulubiony kolor to niebieski" });
    expect(scoreCandidate(rel, ["faktura", "płatności"], NOW)).toBeGreaterThan(scoreCandidate(irrel, ["faktura", "płatności"], NOW));
  });

  it("dedup identycznej treści (zostaje jedna)", () => {
    const r = curateContext([
      item({ text: "Ten sam fakt", at: NOW - 5 * DAY }),
      item({ text: "Ten sam fakt", at: NOW - 1 * DAY }),
    ], { query: "fakt", now: NOW, budgetChars: 1000 });
    expect(r.items.length).toBe(1);
  });

  it("budżet znaków ogranicza ilość (bierze najlepsze)", () => {
    const many = Array.from({ length: 50 }, (_, i) => item({ text: `fakt numer ${i} `.repeat(10), at: NOW - i * DAY }));
    const r = curateContext(many, { query: "fakt", now: NOW, budgetChars: 300 });
    expect(r.usedChars).toBeLessThanOrEqual(300 + many[0].text.length); // mieści się w budżecie (z jednym buforem)
    expect(r.items.length).toBeLessThan(50);
  });

  it("pusty kontekst → pusty wynik, bez wywałki", () => {
    const r = curateContext([], { query: "cokolwiek", now: NOW, budgetChars: 1000 });
    expect(r.items).toEqual([]);
    expect(r.contradictions).toEqual([]);
  });

  it("budżet zależy od złożoności i wielkości modelu", () => {
    expect(contextBudgetChars({ complex: true })).toBeGreaterThan(contextBudgetChars({ complex: false }));
    expect(contextBudgetChars({ complex: true, bigModel: true })).toBeGreaterThan(contextBudgetChars({ complex: true }));
  });
});
