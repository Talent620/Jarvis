// === Natywne zachowanie Androida: sprzętowy przycisk Wstecz (LIFO) + subtelne haptyki ===
// Czysta logika (testowalna bez urządzenia) + bezpieczny wrapper dla Capacitor/WebView.

export interface AndroidBackState {
  showCmd: boolean;
  hasConsent: boolean;
  showRelicense: boolean;
  showVoice: boolean;
  showLive: boolean;
  showHud: boolean;
  showBoss: boolean;
  showNotifs: boolean;
  hasRouteScreen: boolean;
  isBusy: boolean;
}

export type BackResolution =
  | "close_cmd"
  | "deny_consent"
  | "close_relicense"
  | "close_voice"
  | "close_live"
  | "close_hud"
  | "close_boss"
  | "close_notifs"
  | "route_back"
  | "stop_generation"
  | "confirm_exit";

/** Pure: wybierz, co ma zamknąć sprzętowy przycisk Wstecz na Androidzie (kolejność LIFO). */
export function resolveBackAction(s: AndroidBackState): BackResolution {
  if (s.showCmd) return "close_cmd";
  if (s.hasConsent) return "deny_consent";
  if (s.showRelicense) return "close_relicense";
  if (s.showVoice) return "close_voice";
  if (s.showLive) return "close_live";
  if (s.showHud) return "close_hud";
  if (s.showBoss) return "close_boss";
  if (s.showNotifs) return "close_notifs";
  if (s.hasRouteScreen) return "route_back";
  if (s.isBusy) return "stop_generation";
  return "confirm_exit";
}

export const DOUBLE_BACK_WINDOW_MS = 2000;

/** Pure: podwójne naciśnięcie Wstecz w ciągu 2 s potwierdza minimalizację aplikacji. */
export function shouldExitOnBack(lastBackAt: number, now = Date.now()): boolean {
  return lastBackAt > 0 && now - lastBackAt <= DOUBLE_BACK_WINDOW_MS;
}

const HAPTIC_PATTERN: Record<"light" | "medium" | "success" | "warn", number | number[]> = {
  light: 10,
  medium: 20,
  success: [12, 30, 18],
  warn: [24, 40, 24],
};

/** Dyskretne wibracje dotykowe na telefonie (bezpieczny no-op poza urządzeniami z vibrate / reduced-motion). */
export function hapticTap(kind: "light" | "medium" | "success" | "warn" = "light"): void {
  try {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(HAPTIC_PATTERN[kind]);
    }
  } catch {
    /* ignore */
  }
}
