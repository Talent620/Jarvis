import { describe, it, expect } from "vitest";
import { buildDailyBriefing, briefingToText, plural, type BriefingData } from "../src/lib/dailyBriefing";
import type { Task, Reminder, Project, CalendarEvent } from "../src/types";

const T0 = Date.parse("2026-06-15T09:00:00Z"); // poniedziałek, rano
const today = "2026-06-15";
const yest = "2026-06-13";

function task(p: Partial<Task>): Task {
  return { id: Math.random().toString(36).slice(2), title: "T", done: false, createdAt: T0, ...p };
}

const base = (over: Partial<BriefingData> = {}): BriefingData => ({
  tasks: [],
  reminders: [],
  projects: [],
  events: [],
  ...over,
});

describe("dailyBriefing — plural", () => {
  it("odmienia po polsku", () => {
    expect(plural(1, "zadanie", "zadania", "zadań")).toBe("zadanie");
    expect(plural(3, "zadanie", "zadania", "zadań")).toBe("zadania");
    expect(plural(5, "zadanie", "zadania", "zadań")).toBe("zadań");
    expect(plural(12, "zadanie", "zadania", "zadań")).toBe("zadań");
  });
});

describe("dailyBriefing — buildDailyBriefing", () => {
  it("priorytety i terminy-na-dziś trafiają do topTasks", () => {
    const b = buildDailyBriefing(base({
      tasks: [task({ title: "Pilne", priority: true }), task({ title: "Dziś", due: `${today}T15:00:00Z` }), task({ title: "Kiedyś" })],
    }), T0);
    const titles = b.topTasks.map((t) => t.title);
    expect(titles).toContain("Pilne");
    expect(titles).toContain("Dziś");
    expect(titles).not.toContain("Kiedyś");
    expect(b.topTasks[0].title).toBe("Pilne"); // priorytet pierwszy
  });

  it("wykrywa zaległe zadania i przypomnienia", () => {
    const b = buildDailyBriefing(base({
      tasks: [task({ title: "Spóźnione", due: `${yest}T10:00:00Z` })],
      reminders: [{ id: "r1", text: "Zadzwoń", at: "2026-06-14T08:00:00Z", fired: false, createdAt: T0 } as Reminder],
    }), T0);
    expect(b.overdueTasks.map((t) => t.title)).toEqual(["Spóźnione"]);
    expect(b.overdueReminders).toHaveLength(1);
    expect(b.recommendations.join(" ")).toMatch(/zaległe/i);
  });

  it("wskazuje projekty wymagające uwagi (po zaległych zadaniach)", () => {
    const proj: Project = { id: "p1", name: "Strona WWW", instructions: "", createdAt: T0, updatedAt: T0 };
    const b = buildDailyBriefing(base({
      projects: [proj],
      tasks: [task({ title: "Zaległe w projekcie", projectId: "p1", due: `${yest}T10:00:00Z` })],
    }), T0);
    expect(b.projectsNeedingAttention).toHaveLength(1);
    expect(b.projectsNeedingAttention[0].project.name).toBe("Strona WWW");
    expect(b.projectsNeedingAttention[0].stale).toBe(1);
  });

  it("pusty stan, gdy nic pilnego", () => {
    const b = buildDailyBriefing(base(), T0, "Sir");
    expect(b.empty).toBe(true);
    expect(briefingToText(b)).toMatch(/Nic pilnego/);
    expect(b.greeting).toBe("Dzień dobry, Sir");
  });

  it("briefingToText zawiera sekcje, gdy są dane", () => {
    const ev: CalendarEvent = { id: "e1", title: "Spotkanie", start: `${today}T12:00:00Z` } as CalendarEvent;
    const b = buildDailyBriefing(base({ tasks: [task({ title: "Pilne", priority: true })], events: [ev] }), T0);
    const txt = briefingToText(b);
    expect(txt).toMatch(/Priorytety: Pilne/);
    expect(txt).toMatch(/Spotkanie/);
    expect(txt).toMatch(/Rekomendacje/);
  });
});
