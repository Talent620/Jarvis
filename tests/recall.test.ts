import { describe, it, expect } from "vitest";
import { recallSearch, type RecallItem } from "../src/lib/recall";

const NOW = 1_700_000_000_000;
const day = (n: number) => NOW - n * 86_400_000;

const items: RecallItem[] = [
  { id: "1", type: "Czat", title: "Plan wejścia na rynek", text: "strategia marketingowa i budżet reklamowy", at: day(1) },
  { id: "2", type: "Dziennik", title: "Refleksja", text: "dziś dużo pracy nad projektem", at: day(2) },
  { id: "3", type: "Pamięć", title: "budżet", text: "miesięczny budżet reklamowy to 2000 zł", at: day(200) },
  { id: "4", type: "Zadanie", title: "Zadzwoń do klienta", text: "follow-up oferty", at: day(0) },
];

describe("recallSearch — ranking hybrydowy (leksyka + świeżość)", () => {
  it("pusty / za krótki query → []", () => {
    expect(recallSearch("", items, NOW)).toEqual([]);
    expect(recallSearch("a", items, NOW)).toEqual([]);
  });

  it("znajduje po słowach z tytułu i treści", () => {
    const r = recallSearch("budżet reklamowy", items, NOW);
    const ids = r.map((h) => h.id);
    expect(ids).toContain("1");
    expect(ids).toContain("3");
    expect(ids).not.toContain("2"); // brak trafienia słów
  });

  it("przy równej leksyce wygrywa świeższy wpis", () => {
    // „budżet reklamowy" jest i w #1 (1 dzień temu) i w #3 (200 dni temu).
    const r = recallSearch("budżet reklamowy", items, NOW);
    const i1 = r.findIndex((h) => h.id === "1");
    const i3 = r.findIndex((h) => h.id === "3");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i3).toBeGreaterThanOrEqual(0);
    expect(i1).toBeLessThan(i3); // świeższy wyżej
  });

  it("limit ogranicza liczbę wyników", () => {
    const r = recallSearch("budżet reklamowy projekt klienta oferty", items, NOW, 2);
    expect(r.length).toBeLessThanOrEqual(2);
  });

  it("każde trafienie ma dodatni wynik i zachowuje pola elementu", () => {
    const r = recallSearch("klienta", items, NOW);
    expect(r.length).toBeGreaterThan(0);
    for (const h of r) {
      expect(h.score).toBeGreaterThan(0);
      expect(h.type).toBeTruthy();
      expect(h.title).toBeTruthy();
    }
  });
});
