// === Spokojny ekran główny (homeViewModel) — czysty wybór jednej karty „Teraz" ===
// Czat jest centrum. Nad czatem pokazujemy NAJWYŻEJ JEDNĄ kartę „Teraz", wybraną wg priorytetu:
// krytyczny błąd → zgoda → zadanie dnia → decyzja → sugestia. Reszta trafia do Powiadomień.
// Logika wyboru jest czysta i testowalna; App tylko renderuje wskazaną kartę. S9-safe.

export type NowKind = "critical_error" | "consent" | "daily_task" | "decision" | "suggestion";

export interface HomeSignals {
  criticalError?: boolean; // np. moduł/awaria wymagająca uwagi
  consent?: boolean;       // oczekująca zgoda na działanie zewnętrzne
  dailyTask?: boolean;     // najważniejsze zadanie dnia
  decision?: boolean;      // wykryta decyzja do zapisania
  suggestion?: boolean;    // nienachalna porada/tip
}

// Priorytet malejąco — pierwszy aktywny sygnał wygrywa.
export const NOW_PRIORITY: NowKind[] = ["critical_error", "consent", "daily_task", "decision", "suggestion"];

/** Pure: która JEDNA karta „Teraz" ma się pokazać (albo null — sam czat). */
export function pickNowCard(s: HomeSignals): NowKind | null {
  if (s.criticalError) return "critical_error";
  if (s.consent) return "consent";
  if (s.dailyTask) return "daily_task";
  if (s.decision) return "decision";
  if (s.suggestion) return "suggestion";
  return null;
}

/** Pure: czy dana karta jest teraz tą jedyną do pokazania? (gate dla komponentów). */
export function isNowCard(s: HomeSignals, kind: NowKind): boolean {
  return pickNowCard(s) === kind;
}
