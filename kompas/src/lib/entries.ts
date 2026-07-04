// W1 Daily Capture — moduł domenowy wpisów dziennych (Wykonawca A).
// Zasada: znacznik czasu nadaje WYŁĄCZNIE system (now() z db.ts) — nigdy użytkownik.
import { now, uuid, run, all, one } from "./db";

export interface EntryRow {
  id: string;
  text: string;
  score: number;
  created_at: number; // epoch ms — nadane przez system przy zapisie
}

/**
 * Dodaj wpis dzienny. Tekst jest przycinany; pusty tekst lub ocena spoza 1..5
 * NIE trafia do bazy — funkcja rzuca błąd (UI waliduje wcześniej i nie woła).
 */
export function addEntry(text: string, score: number): EntryRow {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    throw new Error("Pusty wpis — nic nie zapisano.");
  }
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error("Ocena musi być liczbą całkowitą od 1 do 5 — nic nie zapisano.");
  }
  const row: EntryRow = {
    id: uuid(),
    text: trimmed,
    score,
    created_at: now(), // jedyne źródło czasu — obrona S03
  };
  run("INSERT INTO entries (id, text, score, created_at) VALUES (?, ?, ?, ?)", [
    row.id,
    row.text,
    row.score,
    row.created_at,
  ]);
  return row;
}

/** Lista wpisów malejąco po czasie utworzenia (najnowszy pierwszy). */
export function listEntries(): EntryRow[] {
  return all<EntryRow>(
    "SELECT id, text, score, created_at FROM entries ORDER BY created_at DESC, id DESC"
  );
}

/** Liczba wszystkich wpisów. */
export function countEntries(): number {
  const row = one<{ n: number }>("SELECT COUNT(*) AS n FROM entries");
  return row ? Number(row.n) : 0;
}
