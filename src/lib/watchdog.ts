// === 🩺 Watchdog Szefa — pilnuje, czy wszystko działa (start + co jakiś czas) ===
// Składa realne, lokalne kontrole (ustawienia + funkcje) w listę problemów i pomaga
// alarmować TYLKO o nowych sprawach (bez nękania w kółko). Pure tam, gdzie się da.
import { settingsFixes, featureChecks, type HealthItem } from "./healthCheck";

export interface WatchIssue { id: string; title: string; detail: string; severity: "warn" | "err" }

/** Aktualne problemy (z realnych testów ustawień i funkcji). Błędy przed ostrzeżeniami. */
export function healthIssues(): WatchIssue[] {
  let items;
  try { items = [...settingsFixes(), ...featureChecks()]; } catch { return []; }
  return items
    .filter((i) => i.status === "err" || i.status === "warn")
    .map((i): WatchIssue => ({ id: i.id, title: i.title, detail: i.detail, severity: i.status === "err" ? "err" : "warn" }))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "err" ? -1 : 1));
}

/** Najważniejszy problem (błąd > ostrzeżenie). Pure. */
export function topIssue(issues: WatchIssue[]): WatchIssue | null {
  return issues.find((i) => i.severity === "err") || issues[0] || null;
}

/** Które problemy są NOWE względem już zaalarmowanych (po id). Pure. */
export function newIssues(alerted: Set<string> | string[], curr: WatchIssue[]): WatchIssue[] {
  const seen = alerted instanceof Set ? alerted : new Set(alerted);
  return curr.filter((i) => !seen.has(i.id));
}

/** Krótki komunikat alertu (1 linia) dla toasta/głosu. Pure. */
export function alertText(issue: WatchIssue): string {
  return `${issue.severity === "err" ? "⛔" : "⚠"} ${issue.title}`;
}

// === 🛠 Auto-naprawa (self-heal) — JARVIS sam koryguje bezpieczne usterki ustawień ===
// settingsFixes są zaprojektowane jako „JARVIS sam ustawia poprawną wartość" — można je
// zastosować automatycznie (np. zły dostawca bez klucza → przełącz na auto).

/** Usterki, które JARVIS umie naprawić sam (mają gotowy fix). */
export function autoFixable(): HealthItem[] {
  try {
    return settingsFixes().filter((i) => (i.status === "err" || i.status === "warn") && !!i.fix);
  } catch {
    return [];
  }
}

/** Zastosuj bezpieczne auto-naprawy. Zwraca tytuły naprawionych rzeczy (do komunikatu). */
export function applyAutoFixes(): string[] {
  const done: string[] = [];
  for (const it of autoFixable()) {
    try { it.fix!.apply(); done.push(it.title); } catch { /* pojedyncza naprawa best-effort */ }
  }
  return done;
}
