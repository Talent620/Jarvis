// W1 Daily Capture — ekran „Dziś” (Wykonawca A).
// 3 interakcje do zapisu: tekst → ocena → Zapisz (S01).
// Znacznik czasu jest TEKSTEM — żadnej ścieżki edycji (S03).
// Guard synchroniczny przez ref — obrona przed podwójnym submitem (S12).
import { useRef, useState } from "react";
import { flush } from "../lib/db";
import { addEntry, listEntries } from "../lib/entries";
import "./Today.css";

const OCENY = [1, 2, 3, 4, 5];

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** Format czasu wpisu, np. „02.07 14:35” — zawsze z HH:MM. */
function formatCzas(ms: number): string {
  const d = new Date(ms);
  return (
    pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes())
  );
}

export default function Today() {
  const [text, setText] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Nieudany TRWAŁY zapis (flush) — pokazujemy prawdę i NIE czyścimy formularza (P1).
  const [saveError, setSaveError] = useState<string | null>(null);
  // Ref = blokada synchroniczna: drugi klik przed re-renderem też odbije się od guardu.
  const savingRef = useRef(false);

  // Odczyt synchroniczny przy każdym renderze — App re-renderuje po mutacjach bazy.
  const entries = listEntries();

  async function zapisz() {
    if (savingRef.current) return; // już trwa zapis — ignoruj (S12)
    const trimmed = text.trim();
    if (!trimmed || score === null) return; // pusty tekst lub brak oceny — nic nie rób
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      addEntry(trimmed, score);
      // Wpis JEST już w bazie (w pamięci) i na liście — formularz czyścimy od razu,
      // żeby ponowny klik nie stworzył duplikatu (runda 2/#2).
      setText("");
      setScore(null);
      await flush(); // poczekaj, aż snapshot NAPRAWDĘ trafi do IndexedDB (S02/S12)
    } catch (e) {
      // Prawda o trwałości: wpis widnieje na liście, ale NIE jest trwale zapisany —
      // mówi o tym ten alert i stały banner u góry aplikacji (P1).
      setSaveError(e instanceof Error ? e.message : "Zapis nie powiódł się — spróbuj ponownie.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="today">
      <div className="card">
        <label className="label" htmlFor="entry-text">
          Jak minął dzień? (2 zdania wystarczą)
        </label>
        <textarea
          id="entry-text"
          data-testid="entry-text"
          className="input today-text"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Napisz krótko, co się wydarzyło…"
        />
        <span className="label">Nastrój / energia (1–5)</span>
        <div className="today-scores" role="group" aria-label="Ocena dnia">
          {OCENY.map((n) => (
            <button
              key={n}
              type="button"
              data-testid={"entry-score-" + n}
              className={score === n ? "btn score-btn selected" : "btn score-btn"}
              aria-pressed={score === n}
              onClick={() => setScore(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="entry-save"
          className="btn primary today-save"
          disabled={saving}
          onClick={zapisz}
        >
          {saving ? "Zapisywanie…" : "Zapisz"}
        </button>
        {saveError && <div className="alert">{saveError}</div>}
      </div>

      <ul className="list" data-testid="entry-list">
        {entries.length === 0 ? (
          <li className="muted">Brak wpisów — dodaj pierwszy powyżej.</li>
        ) : (
          entries.map((e) => (
            <li key={e.id} data-testid="entry-item" className="entry-item">
              <div className="entry-head">
                {/* Znacznik czasu: tylko tekst, żadnych kontrolek (S03). */}
                <span data-testid="entry-time" className="time">
                  {formatCzas(e.created_at)}
                </span>
                <span className="badge">ocena {e.score}/5</span>
              </div>
              <p className="entry-text">{e.text}</p>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
