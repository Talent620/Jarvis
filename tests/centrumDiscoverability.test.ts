import { describe, it, expect } from "vitest";
import { MANUAL } from "../src/lib/manual";
import { SCREENS } from "../src/lib/navIntent";

// Odkrywalność modułów biznesowych: każdy z dziewiątki „Sprzedaż i biznes" ma być
// znajdowalny w instrukcji (MANUAL) oraz osiągalny z czatu/palety (SCREENS → open_screen).
const BUSINESS_IDS = ["sales", "finance", "mail", "sent", "content", "ads", "brand", "web", "money"];

describe("Centrum — kompletność i unikalność ID biznesowych", () => {
  it("instrukcja (MANUAL) pokrywa wszystkie 9 modułów biznesowych", () => {
    const ids = new Set(MANUAL.map((m) => m.id));
    for (const id of BUSINESS_IDS) {
      expect(ids.has(id), `Brak wpisu w instrukcji dla: ${id}`).toBe(true);
    }
  });

  it("rejestr ekranów (SCREENS) pokrywa wszystkie 9 modułów biznesowych", () => {
    const ids = new Set(SCREENS.map((s) => s.id));
    for (const id of BUSINESS_IDS) {
      expect(ids.has(id), `Brak ekranu w SCREENS dla: ${id}`).toBe(true);
    }
  });

  it("ID w instrukcji są unikalne (brak duplikatów)", () => {
    const ids = MANUAL.map((m) => m.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("ID w SCREENS są unikalne (brak duplikatów)", () => {
    const ids = SCREENS.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("każdy moduł biznesowy w instrukcji ma kategorię, opis i hasła", () => {
    for (const id of BUSINESS_IDS) {
      const e = MANUAL.find((m) => m.id === id)!;
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.what.length).toBeGreaterThan(0);
      expect(e.keywords.length).toBeGreaterThan(0);
    }
  });
});
