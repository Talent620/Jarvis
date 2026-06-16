import { useEffect, useState } from "react";
import { computeFitness } from "../lib/fitness";
import { store } from "../lib/store";

// Wskaźnik sprawności JARVIS-a: jeden rzut oka na to, ile % możliwości masz włączone,
// co najbardziej opłaca się podpiąć (i ile % to doda), oraz pełna lista funkcji.
export default function FitnessPanel() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  // Odśwież po każdej zmianie ustawień (klucze zapisują się od razu → procent rośnie na żywo).
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);

  const f = computeFitness();
  const color =
    f.percent >= 75 ? "var(--ok, #58e08a)" : f.percent >= 50 ? "var(--cyan, #6ce7ff)" : f.percent >= 25 ? "#e8c15a" : "#e0794f";

  return (
    <div className="field" style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontFamily: "Orbitron", fontSize: 32, lineHeight: 1, color }}>{f.percent}%</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Sprawność JARVIS-a — {f.level}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {f.enabledCount} z {f.totalCount} możliwości włączonych
          </div>
        </div>
      </div>

      <div style={{ height: 9, background: "var(--line)", borderRadius: 6, overflow: "hidden", margin: "10px 0" }}>
        <div style={{ width: `${f.percent}%`, height: "100%", background: color, transition: "width .35s ease" }} />
      </div>

      {f.topMissing.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <div className="muted" style={{ marginBottom: 2 }}>Najwięcej zyskasz, włączając:</div>
          {f.topMissing.map((i) => (
            <div key={i.id} style={{ display: "flex", gap: 8, padding: "5px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ color, fontWeight: 700, minWidth: 46 }}>+{i.gainPct}%</span>
              <span>
                <b>{i.label}</b>
                <br />
                <span className="muted" style={{ fontSize: 12 }}>{i.hint}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <button className="btn" style={{ marginTop: 10 }} onClick={() => setOpen((v) => !v)}>
        {open ? "Ukryj pełną listę" : "Pokaż wszystkie funkcje i kategorie"}
      </button>

      {open && (
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
