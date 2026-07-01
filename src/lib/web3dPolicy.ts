// === Adaptacyjny silnik 3D (web3dPolicy) ===
// Strony robią wrażenie, ale NIE zamieniają Samsunga S9 w grzejnik. Tryby: OFF / CSS_3D / REAL_3D /
// AUTO. AUTO i degradacja uwzględniają prefers-reduced-motion, Save-Data, pamięć urządzenia, WebGL i
// klasę telefonu. Realne 3D (WebGL) tylko, gdy użytkownik go chce I urządzenie daje radę — ładowane
// LENIWIE po interakcji, z posterem i pełnym fallbackiem (nie blokuje LCP). Czyste i testowalne.
// S9-safe (bez /u, \p, lookbehind).

export type ThreeDMode = "OFF" | "CSS_3D" | "REAL_3D" | "AUTO";
export type Effective3D = "off" | "css" | "real";

export interface DeviceCaps {
  reducedMotion?: boolean;
  saveData?: boolean;
  deviceMemoryGB?: number;
  webgl?: boolean;
  hardwareConcurrency?: number;
  lowEndPhone?: boolean; // klasa S9 i słabsze
}

export interface Resolved3D {
  effective: Effective3D;
  lazyLoad: boolean;  // realne 3D ładujemy dopiero po interakcji
  poster: boolean;    // najpierw statyczny poster
  fallback: boolean;  // czy zapewniamy pełny fallback (zawsze true dla real/css)
  reason: string;     // krótkie, jawne wyjaśnienie decyzji
}

// Cele Core Web Vitals — 3D nigdy nie może ich złamać (brak obowiązkowego preloadingu 3D).
export const WEB_VITALS_BUDGET = { lcpMs: 2500, inpMs: 200, cls: 0.1 } as const;

export interface ThreeDPreset {
  id: string;
  label: string;
  suggestedMode: ThreeDMode;
  supportsTouch: boolean;
  supportsReducedMotion: boolean;
}

export const THREE_D_PRESETS: ThreeDPreset[] = [
  { id: "product_3d", label: "Produkt 3D (obrót)", suggestedMode: "REAL_3D", supportsTouch: true, supportsReducedMotion: true },
  { id: "architecture", label: "Architektura / bryła", suggestedMode: "REAL_3D", supportsTouch: true, supportsReducedMotion: true },
  { id: "spatial_layers", label: "Warstwy przestrzenne (parallax)", suggestedMode: "CSS_3D", supportsTouch: true, supportsReducedMotion: true },
  { id: "service_card", label: "Interaktywna karta usługi", suggestedMode: "CSS_3D", supportsTouch: true, supportsReducedMotion: true },
  { id: "cinematic_hero", label: "Cinematic hero", suggestedMode: "AUTO", supportsTouch: true, supportsReducedMotion: true },
];

/** Czy urządzenie UDŹWIGNIE realne 3D (WebGL)? Konserwatywnie — lepiej fallback niż grzejnik. */
export function canRunReal3D(caps: DeviceCaps): boolean {
  if (!caps.webgl) return false;
  if (caps.reducedMotion || caps.saveData || caps.lowEndPhone) return false;
  if (typeof caps.deviceMemoryGB === "number" && caps.deviceMemoryGB < 4) return false;
  if (typeof caps.hardwareConcurrency === "number" && caps.hardwareConcurrency < 4) return false;
  return true;
}

/**
 * Pure: rozstrzygnij realny tryb 3D dla urządzenia. REAL_3D zawsze z posterem + lazy-load + fallback.
 * Brak WebGL / reduced-motion / Save-Data / słaby telefon → lekki fallback (CSS 2.5D lub poster/off).
 */
export function resolve3D(requested: ThreeDMode, caps: DeviceCaps): Resolved3D {
  if (requested === "OFF") return { effective: "off", lazyLoad: false, poster: false, fallback: true, reason: "3D wyłączone" };

  // Sygnały oszczędności/dostępności zawsze mają pierwszeństwo — nie męczymy urządzenia.
  if (caps.reducedMotion) return { effective: "css", lazyLoad: false, poster: false, fallback: true, reason: "reduced-motion → lekkie CSS bez ciężkiej animacji" };
  if (caps.saveData) return { effective: "css", lazyLoad: false, poster: false, fallback: true, reason: "Save-Data → lekkie CSS zamiast pobierania modelu" };

  if (requested === "REAL_3D") {
    if (canRunReal3D(caps)) return { effective: "real", lazyLoad: true, poster: true, fallback: true, reason: "urządzenie udźwignie WebGL → realne 3D po interakcji, z posterem" };
    return { effective: caps.lowEndPhone || caps.webgl === false ? "css" : "css", lazyLoad: false, poster: true, fallback: true, reason: "za słabe/bez WebGL → poster + lekki fallback CSS" };
  }

  if (requested === "CSS_3D") return { effective: "css", lazyLoad: false, poster: false, fallback: true, reason: "CSS 2.5D — lekkie i bezpieczne" };

  // AUTO: nigdy nie odpala realnego 3D samo z siebie (to wybiera użytkownik). Zdolne → CSS 2.5D,
  // słabe (S9) → poster/off. Realne 3D pozostaje decyzją użytkownika (REAL_3D).
  if (caps.lowEndPhone || caps.webgl === false) return { effective: "css", lazyLoad: false, poster: true, fallback: true, reason: "AUTO na słabszym telefonie → lekkie CSS 2.5D / poster" };
  return { effective: "css", lazyLoad: false, poster: false, fallback: true, reason: "AUTO → lekkie CSS 2.5D (realne 3D tylko na życzenie)" };
}

/** Pure: zmapuj tryb z blueprintu (off/css/real/auto) na tryb polityki. */
export function toPolicyMode(m: string): ThreeDMode {
  const u = (m || "").toUpperCase();
  if (u === "OFF") return "OFF";
  if (u === "CSS" || u === "CSS_3D") return "CSS_3D";
  if (u === "REAL" || u === "REAL_3D") return "REAL_3D";
  return "AUTO";
}

/**
 * Pure: DETERMINISTYCZNE dyrektywy 3D do promptu generatora — dzięki temu rozstrzygnięta polityka
 * TRAFIA do kodu strony. REAL = realny WebGL (lazy + poster + fallback, nie blokuje LCP). CSS 2.5D
 * jest JAWNIE oznaczone jako NIE-realne 3D (parallax/transform), więc stary hero3d/parallax nie udaje
 * realnego 3D. OFF = bez 3D.
 */
export function threeDInstruction(r: Resolved3D): string {
  if (r.effective === "off") return "3D: BEZ efektów 3D (statycznie).";
  if (r.effective === "real") {
    return [
      "3D: REALNE 3D w <canvas> (lekki WebGL; zewnętrzna biblioteka tylko w przypiętej wersji z obsługą awarii).",
      "- Ładuj LENIWIE dopiero po interakcji/scrollu (IntersectionObserver) — NIE blokuj LCP.",
      "- Najpierw statyczny POSTER; podmień na canvas dopiero po gotowości WebGL.",
      "- Pełny FALLBACK: brak WebGL lub błąd → zostaje poster + wersja lekka.",
      "- Wspieraj dotyk oraz prefers-reduced-motion (wyłącz ruch).",
    ].join("\n");
  }
  return [
    "3D: LEKKIE CSS 2.5D (perspective/transform/parallax) — to NIE jest realne 3D (bez WebGL).",
    r.poster ? "- Pokaż statyczny poster; efekt wyłącznie dekoracyjny i lekki." : "",
    "- Nie obciążaj słabych telefonów; wspieraj dotyk i prefers-reduced-motion.",
  ].filter(Boolean).join("\n");
}

/** Odczyt możliwości urządzenia (guarded — działa też w SSR/testach, zwracając ostrożne domyślne). */
export function detectDeviceCaps(): DeviceCaps {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }) : undefined;
  const win = typeof window !== "undefined" ? window : undefined;
  const reducedMotion = !!win?.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = !!nav?.connection?.saveData;
  const deviceMemoryGB = typeof nav?.deviceMemory === "number" ? nav.deviceMemory : undefined;
  const hardwareConcurrency = typeof nav?.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined;
  let webgl = false;
  try {
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
    }
  } catch { webgl = false; }
  const lowEndPhone = (typeof deviceMemoryGB === "number" && deviceMemoryGB <= 3) || (typeof hardwareConcurrency === "number" && hardwareConcurrency <= 4);
  return { reducedMotion, saveData, deviceMemoryGB, webgl, hardwareConcurrency, lowEndPhone };
}
