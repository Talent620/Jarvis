import { describe, it, expect } from "vitest";
import { parseHM, dayKey, dueNotifications, type NotifyInput } from "../src/lib/proactiveNotify";
import type { Prediction } from "../src/lib/predict";

const at8 = new Date("2026-06-20T09:00:00").getTime(); // 09:00 lokalnie
const pred = (over: Partial<Prediction>): Prediction => ({ id: "x", kind: "deadline", urgency: "high", title: "T", ...over });

describe("proactiveNotify — parseHM", () => {
  it("parsuje HH:MM; odrzuca śmieci/zakres", () => {
    expect(parseHM("08:30")).toBe(510);
    expect(parseHM("7:05")).toBe(425);
    expect(parseHM("24:00")).toBeNull();
    expect(parseHM("xx")).toBeNull();
    expect(parseHM("")).toBeNull();
  });
});

const base = (over: Partial<NotifyInput> = {}): NotifyInput => ({
  enabled: true, dailyBriefing: true, briefingTime: "08:00", briefingLine: "Dzień dobry. Zacznij od X.", predictions: [], ...over,
});

describe("proactiveNotify — dueNotifications (anty-spam)", () => {
  it("wyłączony agent → nic", () => {
    expect(dueNotifications(base({ enabled: false }), at8, new Set())).toEqual([]);
  });
  it("poranny briefing po godzinie → wysyła RAZ dziennie", () => {
    const out = dueNotifications(base(), at8, new Set());
    expect(out).toHaveLength(1);
    expect(out[0].body).toMatch(/Zacznij od X/);
    // dedup: ten sam dzień, klucz już wysłany → nic
    expect(dueNotifications(base(), at8, new Set([out[0].key]))).toEqual([]);
  });
  it("przed godziną briefingu → nie wysyła", () => {
    const at7 = new Date("2026-06-20T07:00:00").getTime();
    expect(dueNotifications(base(), at7, new Set())).toEqual([]);
  });
  it("pusty briefingLine (nic pilnego) → bez briefingu", () => {
    expect(dueNotifications(base({ briefingLine: "" }), at8, new Set())).toEqual([]);
  });
  it("pilne predykcje (high overdue/deadline) → wysyła; med pomija", () => {
    const out = dueNotifications(base({ dailyBriefing: false, predictions: [
      pred({ id: "overdue", kind: "overdue", urgency: "high", title: "⚠ Zaległe", detail: "Zrób." }),
      pred({ id: "t2", kind: "deadline", urgency: "med", title: "później" }),
    ] }), at8, new Set());
    expect(out).toHaveLength(1);
    expect(out[0].body).toMatch(/Zaległe — Zrób\./);
    expect(out[0].key).toMatch(/^pred:overdue:/);
  });
  it("limit 4 powiadomień (anty-zalew)", () => {
    const preds = Array.from({ length: 9 }, (_, i) => pred({ id: `r${i}`, kind: "reminder", urgency: "high", title: `R${i}` }));
    const out = dueNotifications(base({ dailyBriefing: false, predictions: preds }), at8, new Set());
    expect(out.length).toBeLessThanOrEqual(4);
  });
  it("dayKey jest stabilny w obrębie doby", () => {
    expect(dayKey(at8)).toBe(dayKey(new Date("2026-06-20T23:30:00").getTime()));
  });
});

describe("proactiveNotify — tygodniowy recap (re-engage)", () => {
  const sundayEve = new Date("2026-06-21T19:00:00").getTime(); // niedziela 19:00
  const sundayNoon = new Date("2026-06-21T12:00:00").getTime(); // niedziela 12:00 (przed 18:00)
  const recap = base({ dailyBriefing: false, predictions: [], weeklyRecapLine: "📈 Ten tydzień: 12 nowych rzeczy o Tobie." });

  it("niedziela po 18:00 → wysyła recap", () => {
    const out = dueNotifications(recap, sundayEve, new Set());
    expect(out).toHaveLength(1);
    expect(out[0].title).toMatch(/tydzień/i);
    expect(out[0].key).toMatch(/^recap:2026-06-21$/);
  });
  it("niedziela przed 18:00 → nie wysyła", () => {
    expect(dueNotifications(recap, sundayNoon, new Set())).toEqual([]);
  });
  it("dedup: ten sam tydzień już wysłany → nic", () => {
    expect(dueNotifications(recap, sundayEve, new Set(["recap:2026-06-21"]))).toEqual([]);
  });
  it("pusty recap → nic", () => {
    expect(dueNotifications(base({ dailyBriefing: false, weeklyRecapLine: "" }), sundayEve, new Set())).toEqual([]);
  });
});
