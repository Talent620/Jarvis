import { describe, it, expect } from "vitest";
import { livingPulse, pulseCandidates, partOfDay } from "../src/lib/livingPulse";
import type { AppData } from "../src/types";

const base = (): AppData => ({
  tasks: [], notes: [], reminders: [], shopping: [], calendar: [], memory: [], scenes: [],
  audit: [], projects: [], projectFiles: [], tally: [], journal: [], leads: [], flashcards: [],
  bargainWatch: [], sentMail: [], contentPosts: [],
});

const NOW = new Date("2026-06-26T10:00:00").getTime(); // rano

describe("livingPulse — partOfDay", () => {
  it("mapuje godziny na pory dnia", () => {
    expect(partOfDay(new Date("2026-06-26T08:00:00").getTime())).toBe("rano");
    expect(partOfDay(new Date("2026-06-26T12:30:00").getTime())).toBe("południe");
    expect(partOfDay(new Date("2026-06-26T23:00:00").getTime())).toBe("wieczór");
    expect(partOfDay(new Date("2026-06-26T03:00:00").getTime())).toBe("noc");
  });
});

describe("livingPulse — kandydaci z realnych danych", () => {
  it("pusty stan → zawsze jest bazowy puls rytmu (nigdy pusto)", () => {
    const c = pulseCandidates(base(), NOW);
    expect(c.length).toBeGreaterThanOrEqual(1);
    expect(c.some((p) => p.key.startsWith("rhythm-"))).toBe(true);
  });

  it("zaległe zadanie → puls 'uwaga' o zaległości", () => {
    const d = base();
    d.tasks = [{ id: "1", title: "X", done: false, due: new Date("2026-06-20").toISOString(), createdAt: NOW } as any];
    const c = pulseCandidates(d, NOW);
    expect(c.some((p) => p.key === "overdue" && p.tone === "uwaga")).toBe(true);
  });

  it("wysłane maile dziś → puls 'sukces'", () => {
    const d = base();
    d.sentMail = [{ id: "a", to: "x@y.pl", subject: "s", via: "SMTP", at: NOW } as any];
    const c = pulseCandidates(d, NOW);
    expect(c.some((p) => p.key === "win" && p.tone === "sukces")).toBe(true);
  });

  it("lead bez kontaktu → puls 'okazja'", () => {
    const d = base();
    d.leads = [{ id: "l1", company: "Firma", status: "new", createdAt: NOW, updatedAt: NOW } as any];
    const c = pulseCandidates(d, NOW);
    expect(c.some((p) => p.key === "leadsNew" && p.tone === "okazja")).toBe(true);
  });
});

describe("livingPulse — wybór i anty-powtórka", () => {
  it("zwraca puls i NIE powtarza ostatnio pokazanego", () => {
    const d = base();
    d.tasks = [{ id: "1", title: "X", done: false, due: new Date("2026-06-20").toISOString(), createdAt: NOW } as any];
    const first = livingPulse(d, NOW);
    expect(first).not.toBeNull();
    const second = livingPulse(d, NOW, first!.key);
    expect(second!.key).not.toBe(first!.key); // inny kąt niż poprzednio
  });

  it("gdy jest tylko jeden kandydat, i tak coś zwróci (nie null)", () => {
    expect(livingPulse(base(), NOW)).not.toBeNull();
  });
});
