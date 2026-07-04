// === 🧠 Rezerwa głównego API dla mózgu — zawsze 1/3 (domyślnie 35%) zostaje dla czatu/Szefa ===
// Pomysł: pomocnicze wywołania AI (generatory ofert/reklam/treści/stron, weryfikacja) nie mogą
// „przejeść" całego miesięcznego budżetu — gdy zużycie wejdzie w strefę rezerwy, te wywołania
// AUTOMATYCZNIE przechodzą na darmowe modele (a płatny limit zostaje dla mózgu). Mózg (askJarvis)
// nigdy nie jest blokowany. Czyste funkcje liczące + drobny odczyt zużycia.
import { loadUsage, within, totals } from "./usageTelemetry";
import { store } from "./store";

/** Pure: czy pomocnicze AI ma jeszcze budżet (poza rezerwą). Bez budżetu = brak limitu. */
export function auxiliaryAllowed(spentUsd: number, budgetUsd: number, reservePct: number): boolean {
  if (!budgetUsd || budgetUsd <= 0) return true; // brak ustawionego budżetu → nie ograniczamy
  const pct = Math.min(90, Math.max(0, reservePct || 0));
  return spentUsd < budgetUsd * (1 - pct / 100);
}

/** Pure: ile z budżetu wolno wydać na pomocnicze AI (próg wejścia w rezerwę), w $. */
export function auxiliaryCap(budgetUsd: number, reservePct: number): number {
  if (!budgetUsd || budgetUsd <= 0) return 0;
  const pct = Math.min(90, Math.max(0, reservePct || 0));
  return budgetUsd * (1 - pct / 100);
}

/** Wydane w tym miesiącu ($) — z realnego dziennika zużycia. */
export function monthSpentUsd(now = Date.now()): number {
  const d = new Date(now);
  d.setDate(1); d.setHours(0, 0, 0, 0);
  return totals(within(loadUsage(), d.getTime())).costUsd;
}

/** Czy jesteśmy w strefie rezerwy (pomocnicze AI powinno zejść na darmowe). */
export function inReserveZone(now = Date.now()): boolean {
  const s = store.settings;
  return !auxiliaryAllowed(monthSpentUsd(now), s.aiMonthlyBudgetUsd || 0, s.brainReservePct ?? 35);
}
