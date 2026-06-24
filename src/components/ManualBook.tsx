import { useMemo, useState } from "react";
import Guide from "./Guide";
import { searchManual, manualCategories } from "../lib/manual";

// 📖 Instrukcja obsługi / FAQ z wyszukiwarką. Każda funkcja: JAK uruchomić + DO CZEGO służy.
// Dane i wyszukiwanie żyją w lib/manual.ts (jedno źródło, testowane). Komponent jest „głupi":
// pole szukania + pogrupowane wyniki. Używany w Strażniku (Guardian), ale samodzielny.
export default function ManualBook(): React.ReactElement {
  const [q, setQ] = useState("");
  const results = useMemo(() => searchManual(q), [q]);
  const cats = useMemo(() => manualCategories(results), [results]);

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
          {results.length === 0
            ? `Nic nie znalazłem dla „${q}”. Spróbuj innego słowa.`
            : `Znaleziono: ${results.length}`}
        </p>
      )}

      {cats.map((cat) => (
        <div key={cat} style={{ marginTop: 10 }}>
          <h4 style={{ margin: "4px 2px", fontSize: 13, color: "var(--gold)" }}>{cat}</h4>
          {results
            .filter((e) => e.category === cat)
            .map((e) => (
              <Guide key={e.id} title={`${e.icon} ${e.title}`}>
                <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                  <div style={{ marginBottom: 4 }}>
                    <b>▶ Jak uruchomić:</b> {e.how}
                  </div>
                  <div>
                    <b>ℹ Do czego służy:</b> {e.what}
                  </div>
                </div>
              </Guide>
            ))}
        </div>
      ))}
    </div>
  );
}
