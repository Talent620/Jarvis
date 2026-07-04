import { describe, it, expect } from "vitest";
import { reflect, reflectionSummary, type ReflectInput } from "../src/lib/reflection";

const DAY = 86_400_000;
const now = new Date("2026-06-20T20:00:00Z").getTime();
const ep = (topic: string, at: number) => ({ at, kind: "chat" as const, topic });

const base: ReflectInput = { episodes: [], people: [], tasks: [] };

describe("reflection — obserwacje", () => {
  it("powracający temat → obserwacja 'często wracasz do'", () => {
    const episodes = [ep("oferta dla klienta", now - DAY), ep("oferta dla klienta", now - 2 * DAY), ep("oferta dla klienta", now - 3 * DAY)];
    const r = reflect({ ...base, episodes }, now);
    expect(r.some((x) => x.kind === "topic" && /oferta/i.test(x.text))).toBe(true);
  });

  it("dominujące osoby/projekty → obserwacja relacji", () => {
    const people = [
      { id: "1", kind: "person" as const, name: "Anna", confidence: 0.9, mentions: 8, firstSeen: now - 100 * DAY, lastSeen: now - DAY },
      { id: "2", kind: "project" as const, name: "Apollo", confidence: 0.8, mentions: 5, firstSeen: now - 50 * DAY, lastSeen: now - DAY },
    ];
    const r = reflect({ ...base, people }, now);
    expect(r.some((x) => x.kind === "relationship" && /Anna/.test(x.text))).toBe(true);
  });

  it("wysoka domykalność zadań → pochwała; niska → delikatny nudge", () => {
    const good = reflect({ ...base, tasks: Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, title: "t", done: i < 9 })) }, now);
    expect(good.some((x) => x.kind === "productivity")).toBe(true);
    const bad = reflect({ ...base, tasks: Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, title: "t", done: i < 2 })) }, now);
    expect(bad.some((x) => x.kind === "productivity")).toBe(true);
  });

  it("rytm dnia → obserwacja najaktywniejszej pory", () => {
    const episodes = Array.from({ length: 6 }, (_, i) => ep("x", new Date("2026-06-20T21:00:00Z").getTime() - i * DAY)); // wieczory
    const r = reflect({ ...base, episodes }, now);
    expect(r.some((x) => x.kind === "rhythm")).toBe(true);
  });

  it("brak danych → brak obserwacji (bez konfabulacji)", () => {
    expect(reflect(base, now)).toEqual([]);
    expect(reflectionSummary(base, now)).toBe("");
  });
});

describe("reflection — podsumowanie", () => {
  it("reflectionSummary łączy obserwacje w tekst", () => {
    const people = [{ id: "1", kind: "person" as const, name: "Marek", confidence: 0.9, mentions: 6, firstSeen: now - 100 * DAY, lastSeen: now - DAY }];
    const s = reflectionSummary({ ...base, people }, now);
    expect(s.length).toBeGreaterThan(0);
    expect(s).toMatch(/Marek/);
  });
});
