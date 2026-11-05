import { useEffect, useState } from "react";
import { computeFitness } from "../lib/fitness";
import { store } from "../lib/store";

// Lista konfiguracji. Obecność ustawienia nie dowodzi działania modelu ani integracji.
export default function FitnessPanel() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  // Odśwież po każdej zmianie ustawień (klucze zapisują się od razu → procent rośnie na żywo).
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);

  const f = computeFitness();
  return (
    <div className="field" style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Skonfigurowane możliwości: {f.enabledCount}/{f.totalCount}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Licznik zapisanych ustawień i połączeń. Działanie wymaga osobnego testu; nie musisz włączać wszystkich opcji.
          </div>
        </div>
      </div>

      {open && f.topMissing.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <div className="muted" style={{ marginBottom: 2 }}>Dostępne opcje do skonfigurowania:</div>
          {f.topMissing.map((i) => (
            <div key={i.id} style={{ display: "flex", gap: 8, padding: "5px 0", borderTop: "1px solid var(--line)" }}>
              <span>
                <b>{i.label}</b>
                <br />
                <span className="muted" style={{ fontSize: 12 }}>{i.hint}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <button className="btn" aria-expanded={open} style={{ marginTop: 10 }} onClick={() => setOpen((v) => !v)}>
        {open ? "Ukryj szczegóły konfiguracji" : "Pokaż szczegóły konfiguracji"}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Konfiguracja według kategorii:</div>
          {f.categories.map((c) => (
            <div key={c.category} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
              <span>{c.category}</span>
              <span className="muted">
                {c.enabled}/{c.total}
              </span>
            </div>
          ))}
          <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
            {f.items.map((i) => (
              <div key={i.id} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 13, opacity: i.enabled ? 1 : 0.65 }} title={i.hint}>
                <span aria-hidden="true">{i.enabled ? "●" : "○"}</span>
                <span style={{ flex: 1 }}>{i.label}</span>
                <span className="muted" style={{ fontSize: 12 }}>{i.enabled ? "Ustawiono" : "Brak ustawień"}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Liczymy wpisane klucze, adresy i włączone opcje według listy funkcji aplikacji.
            Licznik nie sprawdza poprawności kluczy, osiągalności usług ani jakości odpowiedzi.
          </p>
        </div>
      )}
    </div>
  );
}
