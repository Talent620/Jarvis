import { describe, it, expect } from "vitest";
import { nextBestAction, actionCandidates } from "../src/lib/livingPulse";
import type { AppData } from "../src/types";

const base = (over: Partial<AppData> = {}): AppData => ({
  tasks: [], notes: [], reminders: [], shopping: [], calendar: [], memory: [], scenes: [],
  audit: [], projects: [], projectFiles: [], tally: [], journal: [], leads: [], flashcards: [],
  bargainWatch: [], sentMail: [], contentPosts: [], ...over,
} as AppData);

const NOW = new Date("2026-06-30T10:00:00").getTime();
const DAY = 86_400_000;

describe("nextBestAction — jedna najlepsza czynność", () => {
  it("brak danych → null (UI pokaże spokojny onboarding)", () => {
    expect(nextBestAction(base(), NOW)).toBeNull();
  });

  it("należność do zapłaty ma wysoką wartość biznesową", () => {
    const d = base({ financeProjects: [{ id: "p", name: "P", client: "X", status: "oczekuje_platnosci", amount: 5000, paidAmount: 0, createdAt: 0, updatedAt: 0 }] });
    const a = nextBestAction(d, NOW);
    expect(a?.id).toBe("pay");
    expect(a?.screen).toBe("finance");
    expect(a?.why).toContain("zł");
  });

  it("zaległe zadanie ma najwyższą pilność", () => {
    const d = base({ tasks: [{ id: "t", title: "X", done: false, due: NOW - 2 * DAY, createdAt: 0 } as any] });
    const a = nextBestAction(d, NOW);
    expect(a?.id).toBe("overdue");
    expect(a?.screen).toBe("tasks");
  });

  it("ranking: należność (wartość) wygrywa z nowym leadem", () => {
    const d = base({
      financeProjects: [{ id: "p", name: "P", client: "X", status: "oczekuje_platnosci", amount: 9000, paidAmount: 0, createdAt: 0, updatedAt: 0 }],
      leads: [{ id: "l", company: "Nowa", status: "new" } as any],
    });
    expect(nextBestAction(d, NOW)?.id).toBe("pay");
  });

  it("anty-powtórka: pomija ostatnio pokazaną, gdy są alternatywy", () => {
    const d = base({
      tasks: [{ id: "t", title: "X", done: false, due: NOW - 2 * DAY, createdAt: 0 } as any],
      leads: [{ id: "l", company: "Nowa", status: "new" } as any],
    });
    const first = nextBestAction(d, NOW)!;
    const second = nextBestAction(d, NOW, first.id)!;
    expect(second.id).not.toBe(first.id);
  });

  it("actionCandidates zwraca puste, gdy nic do zrobienia", () => {
    expect(actionCandidates(base(), NOW)).toEqual([]);
  });
});

import { SCREENS } from "../src/lib/navIntent";
describe("nextBestAction — cele nawigacji są realnymi ekranami", () => {
  it("każdy screen z karty Teraz istnieje w SCREENS (open_screen zadziała)", () => {
    const ids = new Set(SCREENS.map((s) => s.id));
    const datasets = [
      base({ financeProjects: [{ id: "p", name: "P", client: "X", status: "oczekuje_platnosci", amount: 5000, paidAmount: 0, createdAt: 0, updatedAt: 0 }] }),
      base({ tasks: [{ id: "t", title: "X", done: false, due: NOW - 2 * DAY, createdAt: 0 } as any] }),
      base({ leads: [{ id: "l", company: "Nowa", status: "new" } as any] }),
    ];
    for (const d of datasets) {
      const a = nextBestAction(d, NOW);
      if (a) expect(ids.has(a.screen), `nieznany ekran: ${a.screen}`).toBe(true);
    }
  });
});
