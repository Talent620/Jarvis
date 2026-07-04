import { describe, it, expect } from "vitest";
import { lifeEntropy } from "../src/lib/lifeEntropy";
import type { AppData } from "../src/types";

const base = (): AppData => ({
  tasks: [], notes: [], reminders: [], shopping: [], calendar: [], memory: [], scenes: [],
  audit: [], projects: [], projectFiles: [], tally: [], journal: [], leads: [], flashcards: [],
  bargainWatch: [], sentMail: [], contentPosts: [],
});

const NOW = new Date("2026-06-26T10:00:00").getTime();
const daysAgo = (n: number) => NOW - n * 86_400_000;

describe("lifeEntropy", () => {
  it("pusty stan → spokój (0) z zachęcającym ruchem", () => {
    const r = lifeEntropy(base(), NOW);
    expect(r.score).toBe(0);
    expect(r.level).toBe("spokój");
    expect(r.topFix).toMatch(/spokojnie/i);
  });

  it("zaległe zadania podnoszą entropię i dają top-fix o zaległościach", () => {
    const d = base();
    d.tasks = Array.from({ length: 5 }, (_, i) => ({ id: String(i), title: "X", done: false, due: new Date(daysAgo(3)).toISOString(), createdAt: NOW } as any));
    const r = lifeEntropy(d, NOW);
    expect(r.score).toBeGreaterThan(0);
    expect(r.drivers.some((x) => x.key === "overdue")).toBe(true);
    expect(r.topFix).toMatch(/zaleg|po terminie/i);
  });

  it("leady bez kontaktu >5 dni → driver 'leads'", () => {
    const d = base();
    d.leads = Array.from({ length: 3 }, (_, i) => ({ id: String(i), company: "F", status: "offer", lastContactedAt: daysAgo(7), createdAt: NOW, updatedAt: NOW } as any));
    const r = lifeEntropy(d, NOW);
    expect(r.drivers.some((x) => x.key === "leads")).toBe(true);
  });

  it("najwyższy driver wyznacza topFix (sortowanie wg severity)", () => {
    const d = base();
    // dużo zaległych (silne) + trochę leadów (słabsze)
    d.tasks = Array.from({ length: 8 }, (_, i) => ({ id: "t" + i, title: "X", done: false, due: new Date(daysAgo(2)).toISOString(), createdAt: NOW } as any));
    d.leads = [{ id: "l", company: "F", status: "offer", lastContactedAt: daysAgo(6), createdAt: NOW, updatedAt: NOW } as any];
    const r = lifeEntropy(d, NOW);
    expect(r.drivers[0].key).toBe("overdue");
    expect(r.topFix).toBe(r.drivers[0].fix);
    expect(["napięcie", "chaos"]).toContain(r.level);
  });
});
