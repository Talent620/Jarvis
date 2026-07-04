// === Ustawienia dla człowieka (settingsModel) — czysta taksonomia ===
// Domyślnie „Podstawowe": Mózg, Głos, Połączenia, Prywatność. Reszta pod „Zaawansowane". Wszystkie
// stare zakładki (id) pozostają osiągalne (deep-linki działają). Logika klasyfikacji jest czysta i
// testowalna; komponent tylko renderuje. S9-safe.

export type SettingsTab = "ai" | "voice" | "behavior" | "interface" | "integrations" | "data";
export type SettingsGroup = "basic" | "advanced";

export interface SettingsTabMeta { group: SettingsGroup; label: string }

// Etykiety po ludzku. „Dane" → „Dane, kopie i bezpieczeństwo". 4 podstawowe = Mózg/Głos/Połączenia/Prywatność.
export const SETTINGS_TAB_META: Record<SettingsTab, SettingsTabMeta> = {
  ai: { group: "basic", label: "🤖 Mózg" },
  voice: { group: "basic", label: "🗣 Głos" },
  integrations: { group: "basic", label: "🔗 Połączenia" },
  data: { group: "basic", label: "🗄 Dane, kopie i bezpieczeństwo" },
  behavior: { group: "advanced", label: "✨ Zachowanie" },
  interface: { group: "advanced", label: "🎨 Interfejs" },
};

export const DEFAULT_SETTINGS_GROUP: SettingsGroup = "basic";

/** Pure: zakładki danej grupy (kolejność jak w metadanych). */
export function tabsInGroup(group: SettingsGroup): SettingsTab[] {
  return (Object.keys(SETTINGS_TAB_META) as SettingsTab[]).filter((t) => SETTINGS_TAB_META[t].group === group);
}

/** Pure: czy zakładka jest podstawowa? */
export function isBasicTab(tab: SettingsTab): boolean {
  return SETTINGS_TAB_META[tab]?.group === "basic";
}

/** Pure: grupa, w której leży zakładka (do auto-przełączenia widoku przy deep-linku w zaawansowane). */
export function groupOfTab(tab: SettingsTab): SettingsGroup {
  return SETTINGS_TAB_META[tab]?.group ?? "advanced";
}

/** Pure: ostrzeżenie o ograniczeniu klucza Google Places (ma być OGRANICZONY do Places API + domeny/aplikacji). */
export const GOOGLE_PLACES_KEY_WARNING =
  "Klucz Google Places ogranicz w Google Cloud: tylko Places API i tylko Twoja aplikacja/domena — inaczej ktoś może go nadużyć na Twój koszt.";
