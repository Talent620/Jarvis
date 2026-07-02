// KOMPAS — powłoka: inicjalizacja bazy + nawigacja 4 ekranów.
// Plik INTEGRATORA — wykonawcy wycinków go nie edytują (PLAN.md).
import { useEffect, useState } from "react";
import { initDb, subscribe } from "./lib/db";
import Today from "./screens/Today";
import Week from "./screens/Week";
import Bet from "./screens/Bet";
import Export from "./screens/Export";

type Screen = "today" | "week" | "bet" | "export";

const TABS: { id: Screen; label: string }[] = [
  { id: "today", label: "Dziś" },
  { id: "week", label: "Tydzień" },
  { id: "bet", label: "Zakład" },
  { id: "export", label: "Eksport" },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("today");
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    initDb().then(() => {
      if (alive) setReady(true);
    });
    const off = subscribe(() => setTick((t) => t + 1));
    return () => {
      alive = false;
      off();
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1 data-testid="app-title">KOMPAS</h1>
      </header>
      <main className="app-main">
        {!ready ? (
          <p className="muted">Wczytywanie…</p>
        ) : screen === "today" ? (
          <Today />
        ) : screen === "week" ? (
          <Week />
        ) : screen === "bet" ? (
          <Bet />
        ) : (
          <Export />
        )}
      </main>
      <nav className="app-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            data-testid={"nav-" + t.id}
            className={screen === t.id ? "nav-btn active" : "nav-btn"}
            onClick={() => setScreen(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
