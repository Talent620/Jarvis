// === Cyfrowy bliźniak biznesu (businessSimulator) — testy ===
// Symulacje są DETERMINISTYCZNE, mają jawne założenia i niepewność, i NIGDY nie zmieniają danych.
// Scenariusze: cena, konwersja, brak danych, koszt czasu, nierealne założenie.
import { describe, it, expect } from "vitest";
import { buildSnapshot, simulateSendOffers, simulatePriceChange, bestClientByProfitToTime, biggestRevenueBlocker } from "../src/lib/businessSimulator";
import type { Lead, FinanceProject } from "../src/types";

const NOW = 3_000_000;
const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "X", status: "new", createdAt: NOW, updatedAt: NOW, ...over });
const fin = (over: Partial<FinanceProject>): FinanceProject => ({ id: "F", name: "P", status: "w_realizacji", amount: 0, createdAt: NOW, updatedAt: NOW, ...over });

describe("buildSnapshot — lokalny obraz biznesu (read-only)", () => {
  it("liczy należności i kontaktowalne leady; nie zmienia danych wejściowych", () => {
    const finance = [fin({ amount: 10000, paidAmount: 3000, status: "oczekuje_platnosci" })];
    const leads = [lead({ email: "a@b.pl" }), lead({ id: "L2" })];
    const snapBefore = JSON.stringify({ finance, leads });
    const snap = buildSnapshot({ finance, leads, now: NOW });
    expect(snap.receivables).toBe(7000);
    expect(snap.contactableLeads).toBe(1);
    expect(JSON.stringify({ finance, leads })).toBe(snapBefore); // brak mutacji
  });

  it("brak danych → snapshot zerowy, bez wymyślania", () => {
    const snap = buildSnapshot({});
    expect(snap.recognizedRevenue).toBe(0);
    expect(snap.leadsCount).toBe(0);
  });
});

describe("simulateSendOffers — co jeśli wyślę N ofert", () => {
  it("oczekiwany przychód = oferty × konwersja × średni deal, z widełkami", () => {
    const r = simulateSendOffers({ offers: 20, conversionRate: 0.1, avgDealValue: 2000 });
    expect(r.value).toBe(4000); // 20 * 0.1 * 2000
    expect(r.low).toBeLessThan(r.value);
    expect(r.high).toBeGreaterThan(r.value);
    expect(r.assumptions.length).toBeGreaterThan(0); // założenia jawne
  });

  it("nierealna konwersja > 100% jest przycinana z ostrzeżeniem", () => {
    const r = simulateSendOffers({ offers: 10, conversionRate: 5, avgDealValue: 1000 });
    expect(r.value).toBe(10000); // konwersja przycięta do 100%
    expect(r.assumptions.join(" ")).toMatch(/nierealn|100%/i);
  });
});

describe("simulatePriceChange — co jeśli podniosę cenę", () => {
  it("uwzględnia spadek popytu (elastyczność) i podaje widełki", () => {
    const r = simulatePriceChange({ baselineRevenue: 10000, deltaPct: 15, demandElasticity: 0.5 });
    // 10000 * 1.15 * (1 - 0.5*0.15) = 11500 * 0.925 = 10637.5
    expect(r.value).toBeCloseTo(10637.5, 1);
    expect(r.high).toBeGreaterThanOrEqual(r.value);
    expect(r.low).toBeLessThanOrEqual(r.value);
  });

  it("skrajna zmiana ceny jest przycinana do realnego zakresu", () => {
    const r = simulatePriceChange({ baselineRevenue: 1000, deltaPct: 9999 });
    expect(r.assumptions.join(" ")).toMatch(/przyci/i);
  });
});

describe("bestClientByProfitToTime — koszt czasu", () => {
  it("klient o wyższym zysku NA GODZINĘ wygrywa, nawet jeśli ma mniejszy zysk łączny", () => {
    const finance = [
      fin({ id: "a", client: "Szybki", amount: 5000, cost: 1000, hours: 10 }),   // 400/h
      fin({ id: "b", client: "Czasochłonny", amount: 12000, cost: 2000, hours: 100 }), // 100/h
    ];
    const rank = bestClientByProfitToTime(finance);
    expect(rank[0].client).toBe("Szybki");
    expect(rank[0].profitPerHour).toBeGreaterThan(rank[1].profitPerHour);
  });
});

describe("biggestRevenueBlocker — co blokuje przychód", () => {
  it("duże należności wskazywane jako bloker", () => {
    const snap = buildSnapshot({ finance: [fin({ amount: 10000, paidAmount: 1000, status: "oczekuje_platnosci" })], now: NOW });
    const b = biggestRevenueBlocker(snap);
    expect(b.blocker).toBe("należności");
  });

  it("brak kontaktowalnych leadów i pusty lejek → bloker to brak kontaktów", () => {
    const snap = buildSnapshot({ leads: [lead({})], finance: [], now: NOW });
    expect(biggestRevenueBlocker(snap).blocker).toBe("brak kontaktowalnych leadów");
  });
});
