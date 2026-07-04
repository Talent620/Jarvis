import { useMemo, useState } from "react";
import Guide from "./Guide";
import { searchManual, manualCategories, entryStatus, runIdFor, type ManualCaps, type ManualEntry } from "../lib/manual";

// 📖 Instrukcja obsługi / FAQ z wyszukiwarką. Każda funkcja: JAK uruchomić + DO CZEGO służy,
// a jeśli Strażnik poda `caps`+`onRun` — także STATUS (gotowe / czego brakuje) i przyciski:
// „▶ Otwórz" (uruchom funkcję) oraz „🛠 Skonfiguruj" (przejdź do ustawień, gdy czegoś brakuje).
// Dane i logika żyją w lib/manual.ts (jedno źródło, testowane). Komponent jest „głupi".
export default function ManualBook({
  caps,
  onRun,
}: {
  caps?: ManualCaps;
  onRun?: (commandId: string) => void;
} = {}): React.ReactElement {
  const [q, setQ] = useState("");
  const results = useMemo(() => searchManual(q), [q]);
  const cats = useMemo(() => manualCategories(results), [results]);

  function actions(e: ManualEntry) {
    if (!onRun) return null;
    const runId = runIdFor(e);
    const st = caps ? entryStatus(e, caps) : null;
    const fixable = st && !st.ready && st.fixable;
    return (
      <div className="chips" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
        {fixable && (
          <button className="btn primary" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }} onClick={() => onRun("settings")}>
            🛠 Skonfiguruj (zrób za mnie)
          </button>
        )}
        {runId && (
          <button className="btn" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }} onClick={() => onRun(runId)}>
            {st && !st.ready ? "▶ Otwórz mimo to" : "▶ Otwórz"}
          </button>
        )}
      </div>
    );
  }

  function badge(e: ManualEntry) {
    if (!caps) return null;
    const st = entryStatus(e, caps);
    return st.ready ? (
      <span style={{ fontSize: 11, color: "#2bff88", fontWeight: 600 }}>✅ Gotowe</span>
    ) : (
      <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600 }} title={`Brakuje: ${st.missing.join(", ")}`}>
        ⚙ Trzeba: {st.missing.join(", ")}
      </span>
    );
  }

  return (
    <div>
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔎 Szukaj funkcji… (np. „mail”, „leady”, „głos”, „okazje”)"
        aria-label="Szukaj w instrukcji obsługi"
        style={{ width: "100%" }}
      />

      {q.trim() && (
        <p className="muted" style={{ fontSize: 12, margin: "6px 2px 4px" }}>
          {results.length === 0 ? `Nic nie znalazłem dla „${q}”. Spróbuj innego słowa.` : `Znaleziono: ${results.length}`}
        </p>
      )}

      {cats.map((cat) => (
        <div key={cat} style={{ marginTop: 10 }}>
          <h4 style={{ margin: "4px 2px", fontSize: 13, color: "var(--gold)" }}>{cat}</h4>
          {results
            .filter((e) => e.category === cat)
            .map((e) => (
              <Guide
                key={e.id}
                title={`${e.icon} ${e.title}${caps ? "  —  " + (entryStatus(e, caps).ready ? "✅" : "⚙") : ""}`}
              >
                <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                  {caps && <div style={{ marginBottom: 6 }}>{badge(e)}</div>}
                  <div style={{ marginBottom: 4 }}>
                    <b>▶ Jak uruchomić:</b> {e.how}
                  </div>
                  <div>
                    <b>ℹ Do czego służy:</b> {e.what}
                  </div>
                  {actions(e)}
                </div>
              </Guide>
            ))}
        </div>
      ))}
    </div>
  );
}
