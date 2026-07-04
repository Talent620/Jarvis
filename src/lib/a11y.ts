// === Dostępność: pułapka fokusu (a11y) — czyste, testowalne ===
// Modal ma zatrzymywać Tab/Shift+Tab WEWNĄTRZ (fokus nie ucieka na tło). Logika wyboru następnego
// elementu jest czysta (bez DOM), więc testowalna; komponent tylko spina ją z realnymi elementami.

/** Selektor elementów, które mogą przyjąć fokus (do pułapki fokusu w modalu). */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Pure: indeks elementu, na który przejść przy Tab/Shift+Tab z zawijaniem (pułapka fokusu).
 * count<=0 → -1 (brak elementów). Tab za ostatnim → pierwszy; Shift+Tab przed pierwszym → ostatni.
 */
export function nextTrapIndex(count: number, activeIndex: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (shift) return activeIndex <= 0 ? count - 1 : activeIndex - 1;
  return activeIndex >= count - 1 ? 0 : activeIndex + 1;
}
