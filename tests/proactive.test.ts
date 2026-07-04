// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { nextNudge, markShown, resetProactive } from "../src/lib/proactive";
import { store } from "../src/lib/store";

// Proaktywny Agent: wybiera JEDEN najważniejszy szturchaniec, z priorytetem i anty-spamem.
const NOW = new Date("2026-06-14T10:00:00.000Z").getTime();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const inMin = (min: number) => new Date(NOW + min * 60_000).toISOString();
const today = new Date(NOW).toISOString().slice(0, 10);

beforeEach(() => {
  resetProactive();
  store.setSettings({ proactiveAgent: true });
  store.setData((d) => {
    (d as any).reminders = []; (d as any).tasks = []; (d as any).calendar = [];
    (d as any).leads = []; (d as any).flashcards = [];
  });
});

describe("nextNudge — proaktywny agent", () => {
  it("pusty stan → brak szturchańca", () => {
    expect(nextNudge(NOW)).toBeNull();
  });

  it("wyłączony agent → null mimo zaległego przypomnienia", () => {
    store.setData((d) => { (d as any).reminders = [{ id: "r1", at: ago(60), text: "Zadzwoń do mamy" }]; });
    store.setSettings({ proactiveAgent: false });
    expect(nextNudge(NOW)).toBeNull();
  });

  it("przypomnienie po terminie → szturchaniec 'reminders' (mówiony)", () => {
    store.setData((d) => { (d as any).reminders = [{ id: "r1", at: ago(60), text: "Zadzwoń do mamy" }]; });
    const n = nextNudge(NOW)!;
    expect(n.kind).toBe("reminders");
    expect(n.speak).toBe(true);
    expect(n.text).toMatch(/Zadzwoń do mamy/);
  });

  it("priorytet: przypomnienie przed zadaniem; po pokazaniu — schodzi do zadania", () => {
    store.setData((d) => {
      (d as any).reminders = [{ id: "r1", at: ago(30), text: "Lek" }];
      (d as any).tasks = [{ id: "t1", title: "Raport", done: false, due: today }];
    });
    expect(nextNudge(NOW)!.kind).toBe("reminders");
    markShown("reminders", NOW);
    expect(nextNudge(NOW)!.kind).toBe("tasks"); // przypomnienie w cooldownie → zadanie
  });

  it("anty-spam: ten sam rodzaj nie wraca w cooldownie", () => {
    store.setData((d) => { (d as any).reminders = [{ id: "r1", at: ago(10), text: "X" }]; });
    const n1 = nextNudge(NOW)!;
    markShown(n1.kind, NOW);
    expect(nextNudge(NOW)).toBeNull(); // nic innego, a reminders odpoczywa
  });

  it("wydarzenie w ciągu godziny → szturchaniec 'event'", () => {
    store.setData((d) => { (d as any).calendar = [{ id: "e1", title: "Spotkanie", start: inMin(30) }]; });
    const n = nextNudge(NOW)!;
    expect(n.kind).toBe("event");
    expect(n.text).toMatch(/Spotkanie/);
  });

  it("zadanie na dziś → szturchaniec 'tasks' z ekranem zadań", () => {
    store.setData((d) => { (d as any).tasks = [{ id: "t1", title: "Faktura", done: false, due: today }]; });
    const n = nextNudge(NOW)!;
    expect(n.kind).toBe("tasks");
    expect(n.screen).toBe("tasks");
  });
});
