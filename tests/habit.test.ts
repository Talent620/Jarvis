import { describe, it, expect } from "vitest";
import { dayKey, computeStreak, weeklyRecap } from "../src/lib/habit";

const DAY = 86_400_000;
const now = new Date("2026-06-20T10:00:00").getTime();
const k = (offsetDays: number) => dayKey(now - offsetDays * DAY);

describe("habit — computeStreak", () => {
  it("pusto → 0", () => {
    expect(computeStreak([], now)).toBe(0);
  });
  it("dziś + wczoraj + przedwczoraj → 3", () => {
    expect(computeStreak([k(0), k(1), k(2)], now)).toBe(3);
  });
  it("nie wszedł dziś, ale wczoraj+przedwczoraj → liczy od wczoraj (2), seria nie zerowana", () => {
    expect(computeStreak([k(1), k(2)], now)).toBe(2);
  });
  it("przerwa (dziś + 2 dni temu, brak wczoraj) → 1", () => {
    expect(computeStreak([k(0), k(2)], now)).toBe(1);
  });
  it("aktywny tylko 3 dni temu → 0 (seria przerwana)", () => {
    expect(computeStreak([k(3)], now)).toBe(0);
  });
});

describe("habit — weeklyRecap", () => {
  const within = now - 2 * DAY;
  const old = now - 20 * DAY;
  it("liczy tylko ostatnie 7 dni + łączny stan faktów", () => {
    const r = weeklyRecap({
      now,
      facts: [{ createdAt: within }, { createdAt: within }, { createdAt: old }],
      tasks: [{ createdAt: within, done: true }, { createdAt: old, done: false }],
      journal: [{ createdAt: within }],
      leads: [],
    });
    expect(r.newFacts).toBe(2);
    expect(r.totalFacts).toBe(3); // łącznie (moat)
    expect(r.newTasks).toBe(1);
    expect(r.newJournal).toBe(1);
    expect(r.line).toMatch(/2 nowych rzeczy o Tobie/);
    expect(r.line).toMatch(/Wiem o Tobie już 3/);
  });
  it("nic w tygodniu, ale są fakty → tylko zdanie o łącznej wiedzy", () => {
    const r = weeklyRecap({ now, facts: [{ createdAt: old }], tasks: [], journal: [], leads: [] });
    expect(r.line).toMatch(/^Wiem o Tobie już 1 rzecz\.$/);
  });
  it("całkiem pusto → pusta linia", () => {
    expect(weeklyRecap({ now, facts: [], tasks: [], journal: [], leads: [] }).line).toBe("");
  });
});
