import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { computeFitness } from "../lib/fitness";
import { store } from "../lib/store";

// Wskaźnik sprawności JARVIS-a: domyślnie zwarty, jednowierszowy pasek postępu
// (nie zasłania konfiguracji). Po rozwinięciu pokazuje brakujące funkcje i kategorie.
export default function FitnessPanel() {
  const [, force] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Odśwież po każdej zmianie ustawień (klucze zapisują się od razu → procent rośnie na żywo).
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);

  const f = computeFitness();
  const color =
    f.percent >= 75 ? "var(--ok)" : f.percent >= 50 ? "var(--cyan)" : f.percent >= 25 ? "var(--gold)" : "#e0794f";

  if (!expanded) {
    return (
      <div className="fitness-compact">
        <div className="fitness-compact-info" style={{ flex: 1 }}>
          <span className="fitness-compact-pct" style={{ color }}>{f.percent}%</span>
          <div className="fitness-compact-bar" aria-label={`Sprawność ${f.percent}%`}>
            <span style={{ width: `${f.percent}%`, background: color }} />
          </div>
          <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Sprawność · {f.enabledCount}/{f.totalCount}
          </span>
        </div>
        <button
          type="button"
          className="chip"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 12 }}
          onClick={() => setExpanded(true)}
        >
          Szczegóły <ChevronDown size={13} strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div className="field" style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 14, background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 26, lineHeight: 1, color }}>{f.percent}%</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Sprawność JARVIS-a — {f.level}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {f.enabledCount} z {f.totalCount} możliwości włączonych
          </div>
        </div>
        <button
          type="button"
          className="chip"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 12 }}
          onClick={() => setExpanded(false)}
        >
          Zwiń <ChevronUp size={13} strokeWidth={2} />
        </button>
      </div>

      <div style={{ height: 6, background: "var(--line)", borderRadius: 999, overflow: "hidden", margin: "10px 0" }}>
        <div style={{ width: `${f.percent}%`, height: "100%", background: color, transition: "width .35s ease" }} />
      </div>

      {f.topMissing.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <div className="muted" style={{ marginBottom: 4 }}>Najwięcej zyskasz, włączając:</div>
          {f.topMissing.map((i) => (
            <div key={i.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ color, fontWeight: 700, minWidth: 42, fontFamily: "var(--font-mono)", fontSize: 12 }}>+{i.gainPct}%</span>
              <span style={{ minWidth: 0 }}>
                <b>{i.label}</b>
                <br />
                <span className="muted" style={{ fontSize: 12 }}>{i.hint}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setShowAll((v) => !v)}>
        {showAll ? "Ukryj pełną listę" : "Pokaż wszystkie funkcje i kategorie"}
      </button>

      {showAll && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Sprawność wg kategorii:</div>
          {f.categories.map((c) => (
            <div key={c.category} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
              <span>{c.category}</span>
              <span className="muted">
                {c.enabled}/{c.total} · {c.percent}%
              </span>
            </div>
          ))}
          <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
            {f.items.map((i) => (
              <div key={i.id} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 13, opacity: i.enabled ? 1 : 0.65 }} title={i.hint}>
                <span>{i.enabled ? "✅" : "▫️"}</span>
                <span style={{ flex: 1 }}>{i.label}</span>
                <span className="muted" style={{ fontSize: 12 }}>{i.gainPct}%</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Procent liczony z tego, co masz skonfigurowane w Ustawieniach. Każda funkcja ma wagę wg realnej
            wartości — klucz AI daje najwięcej (fundament), reszta dokłada konkretne zdolności.
          </p>
        </div>
      )}
    </div>
  );
}
