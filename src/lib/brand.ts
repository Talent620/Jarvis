import { store } from "./store";

// White-label (Faza 9): nazwa asystenta widoczna w UI. Domyślnie „JARVIS".
// Logika modelu/promptów pozostaje bez zmian — to wyłącznie warstwa prezentacji.
export const DEFAULT_BRAND = "JARVIS";

/** Bieżąca nazwa marki (z ustawień; pusta → domyślna). Przycięta do rozsądnej długości. */
export function brand(): string {
  const n = (store.settings.brandName || "").trim();
  return (n || DEFAULT_BRAND).slice(0, 32);
}
