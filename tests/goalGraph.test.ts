// === Cele wynikowe (goalGraph) — testy ===
// Postęp wynika z DANYCH, nie z deklaracji modelu. Sprawdzamy: postęp po zdarzeniu (wpłata,
// wygrany klient), częściową wpłatę, anulowany projekt (nie liczy), termin (overdue), brak danych.
import { describe, it, expect } from "vitest";
import { computeMetricValue, computeProgress, progressFromData, suggestMetric, extractTarget, buildOutcomeGoal, type OutcomeGoal } from "../src/lib/goalGraph";
import type { Lead, FinanceProject } from "../src/types";

const NOW = 2_000_000;
const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "X", status: "new", createdAt: NOW, updatedAt: NOW, ...over });
const fin = (over: Partial<FinanceProject>): FinanceProject => ({ id: "F", name: "P", status: "w_realizacji", amount: 0, createdAt: NOW, updatedAt: NOW, ...over });

describe("goalGraph — metryka z danych", () => {
  it("payments liczy realne wpłaty (też częściowe), pomija anulowane", () => {
    const finance = [
      fin({ id: "a", amount: 10000, paidAmount: 4000, status: "oczekuje_platnosci" }),
      fin({ id: "b", amount: 5000, paidAmount: 5000, status: "oplacone" }),
      fin({ id: "c", amount: 9999, paidAmount: 9999, status: "anulowane" }), // anulowane → poza grą
    ];
    expect(computeMetricValue("payments", { finance })).toBe(9000); // 4000 + 5000 (bez anulowanego)
  });

  it("clients_won liczy leady wygrane; project_done liczy ukończone", () => {
    const leads = [lead({ id: "1", status: "won" }), lead({ id: "2", status: "offer" }), lead({ id: "3", status: "won" })];
    expect(computeMetricValue("clients_won", { leads })).toBe(2);
    const finance = [fin({ status: "oplacone" }), fin({ status: "zamkniete" }), fin({ status: "anulowane" })];
    expect(computeMetricValue("project_done", { finance })).toBe(2); // domknięty = opłacony/zamknięty
  });

  it("brak danych → metryka 0", () => {
    expect(computeMetricValue("revenue", {})).toBe(0);
    expect(computeMetricValue("leads", {})).toBe(0);
  });
});

describe("goalGraph — postęp i termin", () => {
  const goal: OutcomeGoal = { id: "g", desiredOutcome: "5 klientów", metric: "clients_won", baseline: 0, target: 5, createdAt: NOW };

  it("postęp po zdarzeniu: kolejny wygrany klient zwiększa postęp", () => {
    const p1 = progressFromData(goal, { leads: [lead({ status: "won" })] }, NOW);
    const p2 = progressFromData(goal, { leads: [lead({ id: "a", status: "won" }), lead({ id: "b", status: "won" })] }, NOW);
    expect(p2.current).toBeGreaterThan(p1.current);
    expect(p2.pct).toBeGreaterThan(p1.pct);
    expect(p2.reached).toBe(false);
  });

  it("cel osiągnięty, gdy current >= target", () => {
    const p = computeProgress(goal, 5, NOW);
    expect(p.reached).toBe(true);
    expect(p.pct).toBe(1);
    expect(p.remaining).toBe(0);
  });

  it("po terminie i nieosiągnięty → overdue", () => {
    const withDeadline: OutcomeGoal = { ...goal, deadline: NOW - 1 };
    const p = computeProgress(withDeadline, 2, NOW);
    expect(p.overdue).toBe(true);
    expect(p.note).toMatch(/termin/i);
  });

  it("częściowa wpłata: postęp celu przychodowego rośnie proporcjonalnie", () => {
    const revGoal: OutcomeGoal = { id: "r", desiredOutcome: "przychód", metric: "payments", baseline: 0, target: 10000, createdAt: NOW };
    const p = progressFromData(revGoal, { finance: [fin({ paidAmount: 2500, status: "oczekuje_platnosci" })] }, NOW);
    expect(p.current).toBe(2500);
    expect(p.pct).toBeCloseTo(0.25, 5);
  });
});

describe("goalGraph — propozycja metryki i celu z języka", () => {
  it("rozpoznaje typ celu", () => {
    expect(suggestMetric("Zwiększ mi przychód w tym miesiącu")).toBe("revenue");
    expect(suggestMetric("Zdobądź 5 klientów")).toBe("clients_won");
    expect(suggestMetric("Domknij ten projekt")).toBe("project_done");
    expect(suggestMetric("Pogadajmy o pogodzie")).toBe("custom");
  });

  it("wyciąga liczbę docelową", () => {
    expect(extractTarget("zdobądź 5 klientów")).toBe(5);
    expect(extractTarget("bez liczby")).toBeUndefined();
  });

  it("buildOutcomeGoal startuje od FAKTYCZNEGO stanu danych jako baseline", () => {
    const leads = [lead({ id: "1", status: "won" })]; // już 1 wygrany
    const g = buildOutcomeGoal("zdobądź 5 klientów", { id: "g", now: NOW, src: { leads } });
    expect(g.metric).toBe("clients_won");
    expect(g.baseline).toBe(1);
    expect(g.target).toBe(5);
  });
});
