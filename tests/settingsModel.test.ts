// === Ustawienia dla człowieka (settingsModel) — testy ===
// Domyślnie „Podstawowe" z 4 sekcjami; reszta w „Zaawansowane"; wszystkie stare zakładki osiągalne.
import { describe, it, expect } from "vitest";
import { SETTINGS_TAB_META, DEFAULT_SETTINGS_GROUP, tabsInGroup, isBasicTab, groupOfTab, GOOGLE_PLACES_KEY_WARNING } from "../src/lib/settingsModel";

describe("settingsModel — Podstawowe vs Zaawansowane", () => {
  it("domyślny widok to Podstawowe", () => {
    expect(DEFAULT_SETTINGS_GROUP).toBe("basic");
  });

  it("cztery sekcje podstawowe: Mózg, Głos, Połączenia, Prywatność(Dane)", () => {
    expect(tabsInGroup("basic")).toEqual(["ai", "voice", "integrations", "data"]);
    expect(SETTINGS_TAB_META.ai.label).toContain("Mózg");
    expect(SETTINGS_TAB_META.integrations.label).toContain("Połączenia");
    expect(SETTINGS_TAB_META.data.label).toContain("Dane, kopie i bezpieczeństwo");
  });

  it("Zachowanie i Interfejs są zaawansowane", () => {
    expect(tabsInGroup("advanced")).toEqual(["behavior", "interface"]);
    expect(isBasicTab("behavior")).toBe(false);
  });

  it("wszystkie 6 starych zakładek nadal istnieje (deep-linki działają)", () => {
    const all = Object.keys(SETTINGS_TAB_META).sort();
    expect(all).toEqual(["ai", "behavior", "data", "integrations", "interface", "voice"]);
  });

  it("groupOfTab wskazuje grupę (do auto-przełączenia widoku)", () => {
    expect(groupOfTab("interface")).toBe("advanced");
    expect(groupOfTab("voice")).toBe("basic");
  });

  it("jest ostrzeżenie o ograniczeniu klucza Google Places", () => {
    expect(GOOGLE_PLACES_KEY_WARNING).toMatch(/Places API/);
  });
});
