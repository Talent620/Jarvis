// W2 Typed Memory — statystyki tygodniowe liczone WYŁĄCZNIE z lokalnych wpisów.
// Okno = ostatnie 7 dni kalendarzowych (od dziś wstecz), czas lokalny.
import { all } from "./db";

export interface DayStat {
  label: string; // np. „pon 29.06”
  count: number; // liczba wpisów danego dnia
  avgScore: number | null; // średnia ocena danego dnia (null, gdy brak wpisów)
}

export interface WeekStatsResult {
  enough: boolean; // >=5 wpisów ORAZ >=3 różne dni kalendarzowe w oknie
  count: number; // łączna liczba wpisów w oknie
  days: DayStat[]; // ZAWSZE 7 wierszy: najstarszy → dziś
}

// Skróty dni tygodnia po polsku (indeks = Date.getDay(): 0 = niedziela).
const DNI = ["nd", "pon", "wt", "śr", "czw", "pt", "sob"];

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** Klucz dnia kalendarzowego w czasie lokalnym (rok-miesiąc-dzień). */
function dayKey(d: Date): string {
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

/**
 * Statystyki ostatnich 7 dni kalendarzowych względem nowMs.
 * enough egzekwuje uczciwość: bez minimum danych nie ma „wzorca” (S04).
 */
export function weekStats(nowMs: number): WeekStatsResult {
  // Zbuduj 7 kubełków dni: od najstarszego (6 dni temu) do dziś.
  const buckets: { key: string; label: string; count: number; sum: number }[] = [];
  const byKey = new Map<string, { count: number; sum: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const label = DNI[d.getDay()] + " " + pad2(d.getDate()) + "." + pad2(d.getMonth() + 1);
    const bucket = { key, label, count: 0, sum: 0 };
    buckets.push(bucket);
    byKey.set(key, bucket);
  }

  // Przypisz wpisy do dni okna (wpisy spoza okna są pomijane).
  const rows = all<{ score: number; created_at: number }>(
    "SELECT score, created_at FROM entries"
  );
  let count = 0;
  for (const row of rows) {
    const key = dayKey(new Date(Number(row.created_at)));
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.sum += Number(row.score);
    count += 1;
  }

  const distinctDays = buckets.filter((b) => b.count > 0).length;
  const days: DayStat[] = buckets.map((b) => ({
    label: b.label,
    count: b.count,
    avgScore: b.count > 0 ? Math.round((b.sum / b.count) * 10) / 10 : null,
  }));

  return {
    enough: count >= 5 && distinctDays >= 3,
    count,
    days,
  };
}
