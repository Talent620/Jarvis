import { describe, it, expect } from "vitest";
import { staleTasks, upcomingEvents, buildSuggestions } from "../src/lib/proactivity";
import type { Episode } from "../src/lib/episodicMemory";
import type { Task, CalendarEvent } from "../src/types";

const DAY = 86_400_000;
const now = Date.parse("2026-06-18T09:00:00Z"); // poranek

const task = (over: Partial<Task>): Task => ({ id: "t" + Math.random(), title: "Zadanie", done: false, createdAt: 0, ...over });
const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({ id: "e" + Math.random(), title: "Spotkanie", start: "", createdAt: 0, ...over });

describe("proactivity — pomocnicze", () => {
  it("staleTasks: tylko niezrobione, zaległe >3 dni", () => {
    const tasks = [
      task({ due: new Date(now - 5 * DAY).toISOString() }), // zaległe
      task({ due: new Date(now - 1 * DAY).toISOString() }), // świeże zaległe (≤3 dni)
      task({ done: true, due: new Date(now - 9 * DAY).toISOString() }), // zrobione
    ];
    expect(staleTasks(tasks, now)).toHaveLength(1);
  });

  it("upcomingEvents: w oknie najbliższych 2h, posortowane", () => {
    const events = [
      ev({ start: new Date(now + 90 * 60000).toISOString(), title: "Późniejsze" }),
      ev({ start: new Date(now + 30 * 60000).toISOString(), title: "Wcześniejsze" }),
      ev({ start: new Date(now + 5 * 3600000).toISOString(), title: "Za daleko" }),
      ev({ start: new Date(now - 60000).toISOString(), title: "Już było" }),
    ];
    const up = upcomingEvents(events, now);
    expect(up.map((e) => e.title)).toEqual(["Wcześniejsze", "Późniejsze"]);
  });
});

describe("proactivity — buildSuggestions", () => {
  it("najbliższe wydarzenie ma najwyższy priorytet", () => {
    const events = [ev({ id: "x", start: new Date(now + 20 * 60000).toISOString(), title: "Call" })];
    const out = buildSuggestions({ tasks: [], events, episodes: [], hasTasksOrEventsToday: true }, now);
    expect(out[0].id).toBe("event:x");
  });

  it("rano proponuje briefing, gdy są zadania/wydarzenia na dziś", () => {
    const out = buildSuggestions({ tasks: [], events: [], episodes: [], hasTasksOrEventsToday: true }, now);
    expect(out.some((s) => s.id === "briefing")).toBe(true);
  });

  it("sygnalizuje zaległe zadania", () => {
    const tasks = [task({ due: new Date(now - 6 * DAY).toISOString() })];
    const out = buildSuggestions({ tasks, events: [], episodes: [], hasTasksOrEventsToday: false }, now);
    expect(out.some((s) => s.id === "stale-tasks")).toBe(true);
  });

  it("wyłania powracający, porzucony temat z epizodów", () => {
    // 'raporty' wspominane 3× w ostatnim miesiącu, ale nie w ostatnich dniach
    const episodes: Episode[] = [
      { at: now - 20 * DAY, kind: "chat", topic: "przygotuj raporty kwartalne" },
      { at: now - 18 * DAY, kind: "chat", topic: "raporty do zarządu" },
      { at: now - 15 * DAY, kind: "chat", topic: "raporty sprzedaży" },
      { at: now - 1 * 3600000, kind: "chat", topic: "pogoda jutro" },
    ];
    const out = buildSuggestions({ tasks: [], events: [], episodes, hasTasksOrEventsToday: false }, now);
    expect(out.some((s) => s.id === "topic:raporty")).toBe(true);
  });

  it("ogranicza liczbę propozycji do max", () => {
    const tasks = [task({ due: new Date(now - 6 * DAY).toISOString() })];
    const events = [ev({ start: new Date(now + 10 * 60000).toISOString() })];
    const out = buildSuggestions({ tasks, events, episodes: [], hasTasksOrEventsToday: true }, now, 2);
    expect(out.length).toBeLessThanOrEqual(2);
  });
});
