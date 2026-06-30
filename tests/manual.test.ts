import { describe, it, expect } from "vitest";
import { MANUAL, searchManual, manualCategories, entryStatus, runIdFor, type ManualEntry, type ManualCaps } from "../src/lib/manual";

const ALL_TRUE: ManualCaps = { brain: true, mail: true, gemini: true, stt: true, vision: true, google: true, images: true, desktop: true };
const ALL_FALSE: ManualCaps = { brain: false, mail: false, gemini: false, stt: false, vision: false, google: false, images: false, desktop: false };
const byId = (id: string) => MANUAL.find((e) => e.id === id)!;

describe("manual (instrukcja obsługi)", () => {
  it("każdy wpis ma komplet pól (jak uruchomić + do czego)", () => {
    for (const e of MANUAL) {
      expect(e.id, `id w ${e.title}`).toBeTruthy();
      expect(e.title).toBeTruthy();
      expect(e.how, `how w ${e.id}`).toBeTruthy();
      expect(e.what, `what w ${e.id}`).toBeTruthy();
      expect(e.category).toBeTruthy();
    }
  });

  it("identyfikatory są unikalne", () => {
    const ids = MANUAL.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puste zapytanie zwraca całą listę", () => {
    expect(searchManual("")).toHaveLength(MANUAL.length);
    expect(searchManual("   ")).toHaveLength(MANUAL.length);
  });

  it("znajduje po tytule", () => {
    const r = searchManual("łowca");
    expect(r.some((e) => e.id === "bargain")).toBe(true);
  });

  it("jest odporne na polskie znaki (bez ogonków też działa)", () => {
    expect(searchManual("lowca").some((e) => e.id === "bargain")).toBe(true);
    expect(searchManual("głos").some((e) => e.id === "voicemode")).toBe(true);
    expect(searchManual("glos").some((e) => e.id === "voicemode")).toBe(true);
  });

  it("ignoruje wielkość liter", () => {
    expect(searchManual("LEADY").some((e) => e.id === "sales")).toBe(true);
  });

  it("szuka po słowach kluczowych i opisie, nie tylko tytule", () => {
    expect(searchManual("crm").some((e) => e.id === "sales")).toBe(true); // keyword
    expect(searchManual("fiszki").some((e) => e.id === "cards")).toBe(true); // keyword/opis
  });

  it("wymaga obecności WSZYSTKICH słów zapytania", () => {
    const r = searchManual("reklamy google");
    expect(r.some((e) => e.id === "ads")).toBe(true);
    // słowo nieistniejące zawęża wynik do zera
    expect(searchManual("reklamy banan")).toHaveLength(0);
  });

  it("nieznane hasło → pusta lista", () => {
    expect(searchManual("xyzqwerty")).toHaveLength(0);
  });

  it("manualCategories zwraca kategorie w kolejności wystąpienia, bez duplikatów", () => {
    const cats = manualCategories();
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats[0]).toBe(MANUAL[0].category);
  });

  it("kluczowe funkcje są opisane", () => {
    const ids = new Set(MANUAL.map((e: ManualEntry) => e.id));
    for (const must of ["chat", "sales", "boss", "guardian", "settings", "recall", "mail"]) {
      expect(ids.has(must), `brakuje wpisu: ${must}`).toBe(true);
    }
  });
});

describe("manual — status dostępności (entryStatus)", () => {
  it("funkcja bez wymagań jest zawsze gotowa", () => {
    expect(entryStatus(byId("recall"), ALL_FALSE).ready).toBe(true);
    expect(entryStatus(byId("tasks"), ALL_FALSE).ready).toBe(true);
  });

  it("Rozmowa na żywo wymaga klucza Gemini", () => {
    expect(entryStatus(byId("live"), ALL_FALSE).ready).toBe(false);
    expect(entryStatus(byId("live"), { ...ALL_FALSE, gemini: true }).ready).toBe(true);
  });

  it("Poczta: gdy brak konfiguracji → niegotowa, ale możliwa do skonfigurowania", () => {
    const st = entryStatus(byId("mail"), ALL_FALSE);
    expect(st.ready).toBe(false);
    expect(st.fixable).toBe(true);
    expect(st.missing.join(" ")).toMatch(/poczt/i);
  });

  it("Sterowanie komputerem: brak EXE → niegotowe i NIE do skonfigurowania (platforma)", () => {
    const st = entryStatus(byId("desktop"), ALL_FALSE);
    expect(st.ready).toBe(false);
    expect(st.fixable).toBe(false);
  });

  it("przy pełnych zdolnościach wszystko jest gotowe", () => {
    for (const e of MANUAL) expect(entryStatus(e, ALL_TRUE).ready, `niegotowe: ${e.id}`).toBe(true);
  });
});

describe("manual — uruchamianie (runIdFor)", () => {
  it("domyślnie id funkcji = id komendy", () => {
    expect(runIdFor(byId("sales"))).toBe("sales");
    expect(runIdFor(byId("settings"))).toBe("settings");
  });

  it("wyjątki mapują na właściwą komendę albo null", () => {
    expect(runIdFor(byId("chat"))).toBeNull(); // główny ekran — nic nie otwieramy
    expect(runIdFor(byId("desktop"))).toBeNull();
    expect(runIdFor(byId("google"))).toBe("settings");
    expect(runIdFor(byId("mail"))).toBe("settings");
    expect(runIdFor(byId("wheretobuy"))).toBe("money");
    expect(runIdFor(byId("shopping"))).toBe("money");
  });

  it("każdy run-id (poza null) to realna komenda z palety App.tsx", () => {
    // Lista id komend z App.tsx (grupy Otwórz/Akcja) — runIdFor nie może wskazywać poza nią.
    const PALETTE_IDS = new Set([
      "settings", "sales", "finance", "mail", "sent", "brand", "goal", "studio", "guardian", "mind",
      "memory", "profile", "tasks", "journal", "web", "money", "bargain", "translator", "transcribe",
      "cards", "content", "ads", "hud", "status", "recall", "data", "boss", "voicemode", "live",
      "newchat", "private", "exportmd", "mic",
    ]);
    for (const e of MANUAL) {
      const rid = runIdFor(e);
      if (rid !== null) expect(PALETTE_IDS.has(rid), `${e.id} → ${rid} (brak takiej komendy)`).toBe(true);
    }
  });
});
