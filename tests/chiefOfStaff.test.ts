import { describe, it, expect } from "vitest";
import { buildChiefBriefing, formatBriefing, briefingOneLiner, type ChiefInput, type Briefing } from "../src/lib/chiefOfStaff";

describe("chiefOfStaff — briefingOneLiner (proaktywny dzień dobry)", () => {
  it("nic pilnego → pusty (bez nagabywania)", () => {
    expect(briefingOneLiner({ heading: "Ranek · x", sections: [], actions: [] })).toBe("");
  });
  it("ranek + akcja → „Dzień dobry. <akcja>”", () => {
    const b: Briefing = { heading: "Ranek · poniedziałek", sections: [{ title: "🎯", items: ["x"] }], actions: ["Zacznij od priorytetu: Raport."] };
    expect(briefingOneLiner(b)).toBe("Dzień dobry. Zacznij od priorytetu: Raport.");
  });
  it("wieczór → „Dobry wieczór”", () => {
    expect(briefingOneLiner({ heading: "Wieczór · x", sections: [], actions: ["Domknij zaległe."] })).toMatch(/^Dobry wieczór\./);
  });
  it("brak akcji, ale jest sygnał → pierwszy element sekcji", () => {
    expect(briefingOneLiner({ heading: "Popołudnie · x", sections: [{ title: "⏳", items: ["Deadline jutro"] }], actions: [] })).toBe("Cześć. Deadline jutro");
  });
});

const DAY = 86_400_000;
const now = new Date("2026-06-20T09:00:00Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const base: ChiefInput = { tasks: [], reminders: [], calendar: [], leads: [], people: [] };

describe("chiefOfStaff — buildChiefBriefing", () => {
  it("nagłówek z porą dnia i sekcje", () => {
    const b = buildChiefBriefing(base, now);
    expect(b.heading).toMatch(/Ranek|Popołudnie|Wieczór/);
    expect(Array.isArray(b.sections)).toBe(true);
    expect(Array.isArray(b.actions)).toBe(true);
  });

  it("priorytet + dzisiejsze wydarzenie trafiają do 'Priorytety / Dziś'", () => {
    const b = buildChiefBriefing({ ...base,
      tasks: [{ id: "1", title: "Ważne", done: false, priority: true }],
      calendar: [{ id: "e", title: "Spotkanie", start: iso(now + 3 * 3600_000), createdAt: now }],
    }, now);
    const dzis = b.sections.find((s) => /Priorytety|Dziś/i.test(s.title));
    expect(dzis).toBeTruthy();
    expect(dzis!.items.join(" ")).toMatch(/Ważne|Spotkanie/);
  });

  it("zaległe zadania → blokery + akcja domknięcia", () => {
    const b = buildChiefBriefing({ ...base,
      tasks: [{ id: "1", title: "Raport", done: false, due: iso(now - 2 * DAY) }],
    }, now);
    const blok = b.sections.find((s) => /Blokery|Uwaga|Zaległ/i.test(s.title));
    expect(blok).toBeTruthy();
    expect(b.actions.join(" ")).toMatch(/zaleg|domkn|przesu/i);
  });

  it("leady z e-mailem bez oferty → szansa + akcja wysyłki ofert", () => {
    const b = buildChiefBriefing({ ...base,
      leads: [{ id: "l", company: "Nova", email: "a@x.pl", status: "new", createdAt: now - DAY, updatedAt: now - DAY }],
    }, now);
    expect(b.actions.join(" ")).toMatch(/ofert/i);
  });

  it("pusty kontekst → spokojna odprawa, bez fałszywych alarmów", () => {
    const b = buildChiefBriefing(base, now);
    expect(b.sections.every((s) => !/Blokery/i.test(s.title) || s.items.length === 0)).toBe(true);
  });
});

describe("chiefOfStaff — formatBriefing", () => {
  it("renderuje nagłówek, sekcje i rekomendowane akcje", () => {
    const b = buildChiefBriefing({ ...base,
      tasks: [{ id: "1", title: "Raport", done: false, due: iso(now - 2 * DAY) }],
    }, now, "słonecznie 22°C");
    const txt = formatBriefing(b);
    expect(txt).toMatch(/Ranek|Popołudnie|Wieczór/);
    expect(txt).toMatch(/słonecznie/);
    expect(txt).toMatch(/Rekomendowane|Następne kroki|Akcje/i);
  });
});
