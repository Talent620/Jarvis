// === Profil wydajności (Samsung S9 i słabsze) ===
// Ostrożnie wykrywa słabe urządzenie i włącza klasę „low-power" na <html>, by CSS mógł
// wyłączyć kosztowne efekty (backdrop-blur, ciężkie cienie, ciągłe animacje pełnoekranowe).
// Czyste, testowalne. Konserwatywne progi — na typowym telefonie NIC się nie zmienia.

export interface DeviceHints {
  deviceMemory?: number; // GB (Chrome) — np. 0.5, 1, 2, 4, 8
  hardwareConcurrency?: number; // liczba rdzeni
  reducedMotion?: boolean; // użytkownik woli mniej ruchu
  saveData?: boolean; // tryb oszczędzania danych
}

/**
 * Pure: czy włączyć tryb low-power? Konserwatywnie — tylko gdy są realne sygnały słabości:
 *  - deviceMemory ≤ 2 GB (np. starsze/budżetowe telefony), albo
 *  - ≤ 2 rdzenie, albo
 *  - użytkownik prosi o mniej ruchu / oszczędzanie danych.
 * Brak danych (undefined) NIE włącza low-power — żeby nie psuć typowych urządzeń.
 */
export function detectLowPower(h: DeviceHints): boolean {
  if (h.reducedMotion) return true;
  if (h.saveData) return true;
  if (typeof h.deviceMemory === "number" && h.deviceMemory > 0 && h.deviceMemory <= 2) return true;
  if (typeof h.hardwareConcurrency === "number" && h.hardwareConcurrency > 0 && h.hardwareConcurrency <= 2) return true;
  return false;
}

/** Zbierz wskazówki z przeglądarki (bezpiecznie — wszystko opcjonalne). */
export function readDeviceHints(): DeviceHints {
  const nav = (typeof navigator !== "undefined" ? navigator : {}) as Navigator & {
    deviceMemory?: number; connection?: { saveData?: boolean };
  };
  let reducedMotion = false;
  try {
    reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { /* brak matchMedia — ignoruj */ }
  return {
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    reducedMotion,
    saveData: !!nav.connection?.saveData,
  };
}

/**
 * Zastosuj profil: dołóż/zdejmij klasę „low-power" na <html>. Ręczne nadpisanie:
 *  override === true  → wymuś low-power;
 *  override === false → wymuś pełne efekty;
 *  override === undefined → autodetekcja.
 * Zwraca finalną decyzję (przydatne w testach).
 */
export function applyPerformanceProfile(override?: boolean): boolean {
  const low = override ?? detectLowPower(readDeviceHints());
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.classList.toggle("low-power", low);
  }
  return low;
}
