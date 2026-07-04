import { describe, it, expect } from "vitest";
import { leadFunnel, segmentReport, monthlyOutcomes, pct, statusCounts } from "../src/lib/salesReports";
import type { Lead, FinanceProject } from "../src/types";

// Raporty sprzedaży: liczone wprost z leadów+finansów. Testy pilnują poprawności agregatów
// i uczciwości (rate = null gdy brak podstawy; segment „—" dla pustego pola; okno miesięcy).

const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime(); // lipiec 2026
const lead = (o: Partial<Lead>): Lead =>
  ({ id: Math.random().toString(36).slice(2), company: "F", status: "new", createdAt: NOW, updatedAt: NOW, ...o } as Lead);

describe("leadFunnel — lejek konwersji", () => {
  it("liczy etapy kumulatywnie i współczynniki", () => {
    const f = leadFunnel([
      lead({ status: "new" }), lead({ status: "new" }),
      lead({ status: "contacted" }),
      lead({ status: "offer" }),
      lead({ status: "won" }),
      lead({ status: "lost" }),
    ]);
    expect(f.total).toBe(6);
    expect(f.engaged).toBe(4);   // wszyscy poza 2× new
    expect(f.offered).toBe(2);   // offer + won
    expect(f.won).toBe(1);
    expect(f.lost).toBe(1);
    expect(f.winRate).toBeCloseTo(0.5); // 1/(1+1)
    expect(f.engageRate).toBeCloseTo(4 / 6);
  });
  it("brak leadów → współczynniki null (nie 0/0)", () => {
    const f = leadFunnel([]);
    expect(f.engageRate).toBeNull();
    expect(f.winRate).toBeNull();
  });
});

describe("segmentReport — skuteczność nisz/miast", () => {
  it("grupuje wg wymiaru, liczy win-rate i wartość wygranych; puste → „—”", () => {
    const rep = segmentReport([
      lead({ niche: "stolarz", status: "won", value: 8000 }),
      lead({ niche: "stolarz", status: "lost" }),
      lead({ niche: "fryzjer", status: "won", value: 3000 }),
      lead({ niche: "", status: "new" }),
    ], "niche");
    const stolarz = rep.find((s) => s.key === "stolarz")!;
    expect(stolarz.count).toBe(2);
    expect(stolarz.won).toBe(1);
    expect(stolarz.wonValue).toBe(8000);
    expect(stolarz.winRate).toBeCloseTo(0.5);
    expect(rep.find((s) => s.key === "—")).toBeTruthy(); // puste pole
    // sort: najwartościowszy segment (stolarz 8000) przed fryzjerem (3000)
    expect(rep[0].key).toBe("stolarz");
  });
});

describe("monthlyOutcomes — wygrane/przegrane + przychód w czasie", () => {
  it("okno = ostatnie N miesięcy, bieżący ostatni; grupuje wg updatedAt/paidAt", () => {
    const may = new Date(2026, 4, 10).getTime();
    const leads = [
      lead({ status: "won", updatedAt: NOW }),          // lipiec
      lead({ status: "lost", updatedAt: NOW }),         // lipiec
      lead({ status: "won", updatedAt: may }),          // maj
      lead({ status: "won", updatedAt: new Date(2025, 0, 1).getTime() }), // poza oknem 6 mies.
    ];
    const fin: FinanceProject[] = [
      { id: "p", name: "x", status: "oplacone", amount: 5000, paidAmount: 5000, paidAt: NOW, createdAt: NOW, updatedAt: NOW } as FinanceProject,
    ];
    const rows = monthlyOutcomes(leads, fin, NOW, 6);
    expect(rows).toHaveLength(6);
    expect(rows[rows.length - 1].label).toMatch(/2026/);   // ostatni = bieżący miesiąc
    const jul = rows[rows.length - 1];
    expect(jul.won).toBe(1);
    expect(jul.lost).toBe(1);
    expect(jul.revenue).toBe(5000);
    const mayRow = rows.find((r) => r.ym === "2026-05")!;
    expect(mayRow.won).toBe(1);
    // lead ze stycznia 2025 poza oknem → nie zliczony nigdzie
    expect(rows.reduce((s, r) => s + r.won, 0)).toBe(2);
  });
  it("brak finansów/leadów nie wywraca (zera)", () => {
    const rows = monthlyOutcomes([], undefined, NOW, 3);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.won === 0 && r.revenue === 0)).toBe(true);
  });
});

describe("pomocnicze", () => {
  it("pct: procent albo „—”", () => {
    expect(pct(0.42)).toBe("42%");
    expect(pct(null)).toBe("—");
  });
  it("statusCounts liczy per etap", () => {
    const c = statusCounts([lead({ status: "new" }), lead({ status: "won" }), lead({ status: "won" })]);
    expect(c.new).toBe(1);
    expect(c.won).toBe(2);
  });
});
