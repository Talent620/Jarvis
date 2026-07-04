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

  it("główny wynik ZAWSZE mieści się we własnych widełkach — nawet przy obniżce z wysoką elastycznością", () => {
    // Kontrprzykład, który wcześniej łamał widełki: obniżka ceny (popyt może wzrosnąć MOCNIEJ niż
    // zakłada wariant "pełnej reakcji" liczony tylko dla podwyżek) z elastycznością bliską maksimum.
    for (const deltaPct of [-90, -60, -30, -10, 0, 10, 50, 200]) {
      for (const demandElasticity of [0, 0.5, 1, 2, 3]) {
        const r = simulatePriceChange({ baselineRevenue: 100000, deltaPct, demandElasticity });
        expect(r.low).toBeLessThanOrEqual(r.value);
        expect(r.high).toBeGreaterThanOrEqual(r.value);
      }
    }
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
    expect(rank[0].profitPerHour).toBeGreaterThan(rank[1].profitPerHour ?? -Infinity);
  });

  it("klient BEZ zapisanych godzin nigdy nie udaje stawki godzinowej ani nie wyprzedza realnej stawki", () => {
    // Bez godzin: 50 000 zł zysku łącznego — gdyby to podstawić jako "zł/h", wygrałby z każdym.
    const finance = [
      fin({ id: "a", client: "Bez godzin", amount: 55000, cost: 5000, hours: 0 }),
      fin({ id: "b", client: "Ze stawką", amount: 5000, cost: 1000, hours: 10 }), // 400 zł/h — realna, skromna stawka
    ];
    const rank = bestClientByProfitToTime(finance);
    const bezGodzin = rank.find((r) => r.client === "Bez godzin")!;
    const zeStawka = rank.find((r) => r.client === "Ze stawką")!;
    expect(bezGodzin.profitPerHour).toBeNull(); // NIE 50000 — to nieznana stawka, nie zysk podstawiony
    // Klient z realną (choć niższą kwotowo) stawką godzinową wyprzedza tego bez danych o czasie.
    expect(rank.indexOf(zeStawka)).toBeLessThan(rank.indexOf(bezGodzin));
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

// Wpięcie do czatu/głosu — silnik istniał wcześniej TYLKO w testach (zero konsumentów produkcyjnych).
// Teraz ma realne narzędzia; sprawdzamy rejestrację, klasyfikację ryzyka (read — bez efektów
// ubocznych) i że wynik liczy się z REALNYCH danych store (nie ze zmyślonych liczb) przez runTool.
describe("businessSimulator — narzędzia czatu (wpięcie produkcyjne)", () => {
  it("simulate_price_change, simulate_send_offers, rank_clients_by_efficiency są w toolDefs i sklasyfikowane read", async () => {
    const { toolDefs } = await import("../src/lib/tools");
    const { riskOf } = await import("../src/lib/permissions");
    for (const name of ["simulate_price_change", "simulate_send_offers", "rank_clients_by_efficiency"]) {
      expect(toolDefs.some((d) => d.name === name)).toBe(true);
      expect(riskOf(name)).toBe("read");
    }
  });

  it("simulate_price_change: wynik jest jawnie oznaczony jako symulacja, niesie założenia", async () => {
    const { runTool } = await import("../src/lib/tools");
    const res = await runTool("simulate_price_change", { delta_pct: 10 });
    expect(res).toContain("SYMULACJA");
    expect(res.toLowerCase()).toContain("założenia");
  });

  it("simulate_send_offers: bez podanej avg_deal_value liczy z REALNYCH finansów w store", async () => {
    const { runTool } = await import("../src/lib/tools");
    const { store } = await import("../src/lib/store");
    store.setData((d) => { d.financeProjects = [{ id: "fp1", name: "P", status: "w_realizacji", amount: 8000, createdAt: 1, updatedAt: 1 }]; });
    const res = await runTool("simulate_send_offers", { offers: 10 });
    expect(res).toContain("SYMULACJA");
    expect(res).toMatch(/8[\s ]?000|8000/); // średnia wartość zlecenia z realnych danych (8000 zł), nie zmyślona
  });

  it("rank_clients_by_efficiency: pusto → jasny komunikat, nie pusta lista udawana za wynik", async () => {
    const { runTool } = await import("../src/lib/tools");
    const { store } = await import("../src/lib/store");
    store.setData((d) => { d.financeProjects = []; });
    const res = await runTool("rank_clients_by_efficiency", {});
    expect(res).toContain("Brak danych");
  });
});
