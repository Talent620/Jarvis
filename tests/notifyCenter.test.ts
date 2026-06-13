// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { dueReminders, soonReminders, notifySummary, dismissReminder } from "../src/lib/notifyCenter";
import { store, uid } from "../src/lib/store";
import type { Lead } from "../src/types";

const NOW = new Date("2026-06-15T12:00:00").getTime();
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  store.setData((d) => { d.reminders = []; d.tasks = []; d.leads = []; d.flashcards = []; });
});

describe("centrum powiadomień — agregacja", () => {
  it("dueReminders: po czasie i nieodhaczone; soonReminders: dziś przed czasem", () => {
    store.setData((d) => {
      d.reminders = [
        { id: "a", text: "Zadzwoń", at: iso(NOW - 3600000), fired: false, createdAt: 0 },     // po czasie → due
        { id: "b", text: "Spotkanie", at: iso(NOW + 3600000), fired: false, createdAt: 0 },    // dziś później → soon
        { id: "c", text: "Stare", at: iso(NOW - 7200000), fired: true, createdAt: 0 },          // odhaczone → pomijamy
      ];
    });
    expect(dueReminders(NOW).map((r) => r.id)).toEqual(["a"]);
    expect(soonReminders(NOW).map((r) => r.id)).toEqual(["b"]);
  });

  it("notifySummary liczy zadania na dziś/zaległe, follow-upy i sumę pilnych", () => {
    const today = new Date(NOW).toISOString().slice(0, 10);
    store.setData((d) => {
      d.reminders = [{ id: "a", text: "x", at: iso(NOW - 1000), fired: false, createdAt: 0 }];
      d.tasks = [
        { id: "t1", title: "Dziś", done: false, due: today, createdAt: 0 },
        { id: "t2", title: "Zrobione", done: true, due: today, createdAt: 0 },
        { id: "t3", title: "Bez terminu", done: false, createdAt: 0 },
      ];
      d.leads = [{ id: "L1", company: "A", status: "contacted", lastContactedAt: NOW - 5 * 86400000, createdAt: 0, updatedAt: 0 } as Lead];
    });
    const s = notifySummary(NOW);
    expect(s.remindersDue).toBe(1);
    expect(s.tasksToday).toBe(1);     // tylko nieukończone z terminem ≤ dziś
    expect(s.followUps).toBe(1);
    expect(s.total).toBe(3);          // 1 + 1 + 1
  });

  it("dismissReminder odhacza i znika z due", () => {
    store.setData((d) => { d.reminders = [{ id: "a", text: "x", at: iso(NOW - 1000), fired: false, createdAt: 0 }]; });
    expect(dueReminders(NOW)).toHaveLength(1);
    dismissReminder("a");
    expect(dueReminders(NOW)).toHaveLength(0);
  });

  it("pusto → zero pilnych", () => {
    expect(notifySummary(NOW).total).toBe(0);
  });
});
