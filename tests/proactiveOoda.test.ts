// === Proaktywny OODA Loop (proactiveOoda) — testy ===
// JARVIS odzywa się rzadziej, ale wtedy, kiedy warto. Sprawdzamy: gorący lead, zaległa płatność,
// termin projektu, brak istotnych zmian (milczy), snooze/cisza i odrzucenie kategorii.
import { describe, it, expect } from "vitest";
import { observeEvents, orient, decideSuggestion, type OodaCategory } from "../src/lib/proactiveOoda";
import type { Lead, FinanceProject } from "../src/types";
import type { OutcomeGoal } from "../src/lib/goalGraph";

const NOW = 7_000_000_000;
const DAY = 86_400_000;
const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "X", status: "new", createdAt: NOW, updatedAt: NOW, ...over });
const fin = (over: Partial<FinanceProject>): FinanceProject => ({ id: "F", name: "P", status: "w_realizacji", amount: 0, createdAt: NOW, updatedAt: NOW, ...over });

describe("proactiveOoda — OBSERVE", () => {
  it("gorący lead (oferta, dawno bez kontaktu) → zdarzenie hot_lead", () => {
    const ev = observeEvents({ leads: [lead({ status: "offer", value: 8000, lastContactedAt: NOW - 5 * DAY })] }, NOW);
    expect(ev.some((e) => e.category === "hot_lead")).toBe(true);
  });

  it("zaległa płatność (po terminie, niezapłacone) → overdue_payment", () => {
    const ev = observeEvents({ finance: [fin({ amount: 5000, paidAmount: 0, status: "oczekuje_platnosci", dueAt: NOW - DAY })] }, NOW);
    expect(ev.some((e) => e.category === "overdue_payment")).toBe(true);
  });

  it("termin projektu w ciągu 48h → project_deadline", () => {
    const ev = observeEvents({ finance: [fin({ amount: 4000, status: "w_realizacji", dueAt: NOW + DAY })] }, NOW);
    expect(ev.some((e) => e.category === "project_deadline")).toBe(true);
  });

  it("brak istotnych zmian → zero zdarzeń", () => {
    const ev = observeEvents({ leads: [lead({ status: "new", lastContactedAt: NOW })], finance: [fin({ status: "oplacone" })] }, NOW);
    expect(ev).toHaveLength(0);
  });
});

describe("proactiveOoda — ORIENT (powiązanie z celem)", () => {
  it("zaległa płatność powiązana z celem przychodowym → wyższy wynik i relatedGoalId", () => {
    const goal: OutcomeGoal = { id: "g", desiredOutcome: "przychód", metric: "revenue", baseline: 0, target: 10000, createdAt: NOW };
    const ev = observeEvents({ finance: [fin({ amount: 5000, status: "oczekuje_platnosci", dueAt: NOW - DAY })] }, NOW)[0];
    const withGoal = orient(ev, [goal]);
    const without = orient(ev, []);
    expect(withGoal.relatedGoalId).toBe("g");
    expect(withGoal.score).toBeGreaterThan(without.score);
  });
});

describe("proactiveOoda — DECIDE + SUGGEST", () => {
  const data = {
    leads: [lead({ id: "lead1", status: "offer", value: 8000, lastContactedAt: NOW - 5 * DAY })],
    finance: [fin({ id: "fin1", name: "Sklep", amount: 9000, paidAmount: 0, status: "oczekuje_platnosci", dueAt: NOW - DAY })],
  };

  it("wybiera JEDNĄ najpilniejszą sugestię z akcjami Zrób/Później/Nie proponuj", () => {
    const s = decideSuggestion(data, { now: NOW });
    expect(s).not.toBeNull();
    expect(s!.category).toBe("overdue_payment"); // płatność pilniejsza niż lead
    expect(s!.actions).toEqual(["Zrób", "Później", "Nie proponuj tego"]);
    expect(s!.whyNow).toBeTruthy();
    expect(s!.expectedEffect).toBeTruthy();
  });

  it("brak istotnych zmian → null (JARVIS milczy)", () => {
    expect(decideSuggestion({ leads: [lead({ status: "new", lastContactedAt: NOW })] }, { now: NOW })).toBeNull();
  });

  it("cisza/snooze danej kategorii → pomija ją i schodzi do kolejnej", () => {
    const s = decideSuggestion(data, { now: NOW, isSilenced: (c) => c === "overdue_payment" });
    expect(s!.category).toBe("hot_lead"); // płatność wyciszona → następny w kolejce
  });

  it("odrzucona kategoria nie jest już proponowana", () => {
    const rejected = new Set<OodaCategory>(["overdue_payment", "hot_lead"]);
    expect(decideSuggestion(data, { now: NOW, rejected })).toBeNull();
  });
});
