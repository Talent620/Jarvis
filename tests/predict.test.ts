import { describe, it, expect } from "vitest";
import { predict, topPredictions, predictionsSummary, type PredictInput } from "../src/lib/predict";

const DAY = 86_400_000;
const now = 1_000 * DAY;
const iso = (ms: number) => new Date(ms).toISOString();

const base: PredictInput = { tasks: [], reminders: [], calendar: [], leads: [], people: [] };

describe("predict — terminy i zaległości", () => {
  it("zaległe zadanie → urgency high (overdue)", () => {
    const p = predict({ ...base, tasks: [{ id: "1", title: "Raport", done: false, due: iso(now - 2 * DAY) }] }, now);
    expect(p.some((x) => x.kind === "overdue" && x.urgency === "high")).toBe(true);
  });
  it("zadanie w ciągu 48h → deadline (med/high)", () => {
    const p = predict({ ...base, tasks: [{ id: "1", title: "Spotkanie", done: false, due: iso(now + DAY) }] }, now);
    expect(p.some((x) => x.kind === "deadline")).toBe(true);
  });
  it("zadanie zrobione lub odległe → brak alarmu", () => {
    const p = predict({ ...base, tasks: [
      { id: "1", title: "Done", done: true, due: iso(now - 5 * DAY) },
      { id: "2", title: "Daleko", done: false, due: iso(now + 30 * DAY) },
    ] }, now);
    expect(p.some((x) => x.kind === "overdue" || x.kind === "deadline")).toBe(false);
  });
  it("przypomnienie w ciągu 24h → reminder; wydarzenie dziś → event", () => {
    const p = predict({ ...base,
      reminders: [{ id: "r", text: "Zadzwoń", at: iso(now + 3600_000), fired: false, createdAt: now }],
      calendar: [{ id: "e", title: "Dentysta", start: iso(now + 5 * 3600_000), createdAt: now }],
    }, now);
    expect(p.some((x) => x.kind === "reminder")).toBe(true);
    expect(p.some((x) => x.kind === "event")).toBe(true);
  });
});

describe("predict — sprzedaż i relacje", () => {
  it("lead po ofercie bez kontaktu od dawna → follow-up (opportunity)", () => {
    const p = predict({ ...base, leads: [
      { id: "l", company: "Nova", status: "offer", lastContactedAt: now - 10 * DAY, createdAt: now - 20 * DAY, updatedAt: now - 10 * DAY },
    ] }, now);
    expect(p.some((x) => x.kind === "lead_followup")).toBe(true);
  });
  it("leady z e-mailem, nowe, bez oferty → szansa na ofertę", () => {
    const p = predict({ ...base, leads: [
      { id: "l", company: "X", email: "a@x.pl", status: "new", createdAt: now - DAY, updatedAt: now - DAY },
      { id: "l2", company: "Y", email: "b@y.pl", status: "new", createdAt: now - DAY, updatedAt: now - DAY },
    ] }, now);
    expect(p.some((x) => x.kind === "lead_opportunity")).toBe(true);
  });
  it("zaniedbana relacja: osoba znana, dawno niewspominana → przypomnienie", () => {
    const p = predict({ ...base, people: [
      { id: "p", kind: "person", name: "Anna", confidence: 0.8, mentions: 6, firstSeen: now - 200 * DAY, lastSeen: now - 60 * DAY },
    ] }, now);
    expect(p.some((x) => x.kind === "relationship")).toBe(true);
  });
});

describe("predict — ranking i podsumowanie", () => {
  it("topPredictions sortuje wg pilności i zwraca limit", () => {
    const input: PredictInput = { ...base, tasks: [
      { id: "1", title: "Zaległe", done: false, due: iso(now - DAY) },
      { id: "2", title: "Wkrótce", done: false, due: iso(now + DAY) },
    ] };
    const top = topPredictions(input, now, 1);
    expect(top).toHaveLength(1);
    expect(top[0].urgency).toBe("high"); // overdue pierwsze
  });
  it("predictionsSummary: pusto → '', z danymi → tekst", () => {
    expect(predictionsSummary(base, now)).toBe("");
    const s = predictionsSummary({ ...base, tasks: [{ id: "1", title: "X", done: false, due: iso(now - DAY) }] }, now);
    expect(s.length).toBeGreaterThan(0);
  });
});
