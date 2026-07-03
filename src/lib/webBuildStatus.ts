// === Status budowy strony w tle (webBuildStatus) ===
// PO CO: budowa strony trwa 30–120 s. Dotąd generacja żyła w otwartym panelu Kreatora —
// zamknięcie okna w trakcie = wynik przepadał. Ten singleton trzyma stan „budowa trwa"
// POZA komponentem (przeżywa odmontowanie panelu), a wynik ląduje w trwałym szkicu
// (draftStore) — więc można zamknąć Kreator, robić coś innego i wrócić po gotową stronę.
// Stan żyje w RAM (restart aplikacji = czysto, brak zawieszonej flagi po crashu). S9-safe.

export interface WebBuildState {
  running: boolean;
  startedAt: number;
  /** Czy to edycja istniejącej strony (inny komunikat powiadomienia). */
  edit: boolean;
}

/** Po tym czasie „wiszącą" budowę wolno przejąć (fetch ma twarde timeouty ~2×120 s; 10 min = na pewno martwa). */
export const BUILD_STALE_MS = 10 * 60_000;

let state: WebBuildState = { running: false, startedAt: 0, edit: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) { try { cb(); } catch { /* słuchacz nie może zabić emitera */ } }
}

export function getWebBuild(): WebBuildState {
  return state;
}

/**
 * Zajmij slot budowy. Zwraca false, gdy inna budowa realnie trwa (guard równoległości —
 * dwie generacje naraz marnują tokeny i nadpisują się nawzajem). Budowę starszą niż
 * BUILD_STALE_MS wolno przejąć (martwy fetch nie blokuje Kreatora na zawsze).
 */
export function beginWebBuild(edit: boolean, now = Date.now()): boolean {
  if (state.running && now - state.startedAt < BUILD_STALE_MS) return false;
  state = { running: true, startedAt: now, edit };
  emit();
  return true;
}

/** Zwolnij slot budowy (ZAWSZE w finally — sukces, błąd i wyjątek tak samo). */
export function endWebBuild(): void {
  state = { running: false, startedAt: 0, edit: false };
  emit();
}

/** Subskrypcja zmian (panel po ponownym otwarciu pokazuje żywy stan budowy). */
export function subscribeWebBuild(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
