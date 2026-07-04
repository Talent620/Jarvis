import { describe, it, expect } from "vitest";
import { gatherSignals, relevance, rankSignals, fuseContext, suggestPrompts, type FusionInput } from "../src/lib/contextFusion";
import type { Task, Reminder, Project, Lead, CalendarEvent } from "../src/types";
import type { Episode } from "../src/lib/episodicMemory";

const NOW = Date.parse("2026-06-15T09:00:00Z");
const DAY = 86_400_000;

const lead = (p: Partial<Lead>): Lead => ({ id: "l1", company: "Firma", status: "new", createdAt: NOW, updatedAt: NOW, ...p });
const task = (p: Partial<Task>): Task => ({ id: "t1", title: "T", done: false, createdAt: NOW, ...p });

const base = (o: Partial<FusionInput> = {}): FusionInput => ({ tasks: [], reminders: [], projects: [], leads: [], events: [], episodes: [], ...o });

describe("contextFusion — gatherSignals", () => {
  it("wykrywa leada w toku bez ruchu (>3 dni)", () => {
    const s = gatherSignals(base({ leads: [lead({ company: "Kowalski Sp. z o.o.", status: "offer", lastContactedAt: NOW - 4 * DAY, value: 5000 })] }), NOW);
    const hit = s.find((x) => x.kind === "lead_stale");
    expect(hit).toBeTruthy();
    expect(hit!.text).toMatch(/Kowalski/);
    expect(hit!.text).toMatch(/4 dni temu/);
    expect(hit!.text).toMatch(/5000/);
  });

  it("wykrywa zaległe zadanie i przypomnienie", () => {
    const s = gatherSignals(base({
      tasks: [task({ title: "Faktura", due: "2026-06-13T10:00:00Z" })],
      reminders: [{ id: "r1", text: "Oddzwoń", at: "2026-06-14T08:00:00Z", fired: false, createdAt: NOW } as Reminder],
    }), NOW);
    expect(s.some((x) => x.kind === "task_overdue" && /Faktura/.test(x.text))).toBe(true);
    expect(s.some((x) => x.kind === "reminder_overdue" && /Oddzwoń/.test(x.text))).toBe(true);
  });

  it("wykrywa najbliższe wydarzenie (≤2h)", () => {
    const ev: CalendarEvent = { id: "e1", title: "Telefon z klientem", start: "2026-06-15T10:00:00Z" } as CalendarEvent;
    const s = gatherSignals(base({ events: [ev] }), NOW);
    expect(s.some((x) => x.kind === "event_soon")).toBe(true);
  });

  it("wykrywa projekt z zaległościami", () => {
    const proj: Project = { id: "p1", name: "Sklep", instructions: "", createdAt: NOW, updatedAt: NOW };
    const s = gatherSignals(base({ projects: [proj], tasks: [task({ title: "x", projectId: "p1", due: "2026-06-10T00:00:00Z" })] }), NOW);
    expect(s.some((x) => x.kind === "project_attention" && /Sklep/.test(x.text))).toBe(true);
  });

  it("wykrywa powracający porzucony temat (epizody)", () => {
    const old = NOW - 20 * DAY;
    const episodes: Episode[] = [
      { at: old, kind: "chat", topic: "podatki kwartalne" },
      { at: old + DAY, kind: "chat", topic: "podatki rozliczenie" },
      { at: old + 2 * DAY, kind: "chat", topic: "podatki termin" },
    ];
    const s = gatherSignals(base({ episodes }), NOW);
    expect(s.some((x) => x.kind === "topic_recurring")).toBe(true);
  });
});

describe("contextFusion — relevance & ranking", () => {
  it("trafność rośnie, gdy encja pasuje do zapytania", () => {
    const sig = { id: "x", kind: "lead_stale" as const, text: "", entity: "Kowalski", urgency: 0.5 };
    expect(relevance(sig, "napisz maila do Kowalskiego")).toBeGreaterThan(0);
    expect(relevance(sig, "jaka dziś pogoda")).toBe(0);
  });

  it("sygnał trafny do zapytania wygrywa z bardziej pilnym, ale nieistotnym", () => {
    const signals = gatherSignals(base({
      leads: [lead({ id: "l1", company: "Kowalski", status: "offer", lastContactedAt: NOW - 4 * DAY })],
      reminders: [{ id: "r1", text: "Kup mleko", at: "2026-06-14T08:00:00Z", fired: false, createdAt: NOW } as Reminder],
    }), NOW);
    const ranked = rankSignals(signals, "napisz do Kowalskiego ofertę");
    expect(ranked[0].entity).toBe("Kowalski");
  });
});

describe("contextFusion — fuseContext (połączenie z wyczuciem)", () => {
  it("HERO: pytanie o Kowalskiego → wplata połączenie o zaległym leadzie", () => {
    const f = fuseContext(base({ leads: [lead({ company: "Kowalski", status: "offer", lastContactedAt: NOW - 5 * DAY })] }), "napisz maila do Kowalskiego", NOW);
    expect(f.connection).toBeTruthy();
    expect(f.connection!.entity).toBe("Kowalski");
    expect(f.awareness).toMatch(/Najtrafniejsze teraz/);
  });

  it("nie naciska, gdy nic nie pasuje do prośby (brak fałszywego połączenia)", () => {
    const f = fuseContext(base({ leads: [lead({ company: "Nowak", status: "offer", lastContactedAt: NOW - 5 * DAY })] }), "ile to jest 2+2 pomnożone przez osiem", NOW);
    expect(f.connection).toBeNull();
    expect(f.awareness).toMatch(/Świadomość sytuacyjna/); // świadomość jest, ale bez nacisku
  });

  it("brak sygnałów → pusty blok", () => {
    const f = fuseContext(base(), "cokolwiek", NOW);
    expect(f.awareness).toBe("");
    expect(f.connection).toBeNull();
  });
});

describe("contextFusion — suggestPrompts (proaktywne podpowiedzi)", () => {
  it("zaległy lead → gotowe polecenie follow-up", () => {
    const s = suggestPrompts(base({ leads: [lead({ company: "Kowalski", status: "offer", lastContactedAt: NOW - 5 * DAY })] }), 2, NOW);
    expect(s[0]).toMatch(/follow-up do „Kowalski"/);
  });

  it("najpilniejsze najpierw + brak sygnałów → pusta lista", () => {
    expect(suggestPrompts(base(), 2, NOW)).toEqual([]);
  });
});
