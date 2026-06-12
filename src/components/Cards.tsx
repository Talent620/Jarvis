import { useMemo, useState } from "react";
import { useStore } from "../hooks/useStore";
import { useEscape } from "../hooks/useEscape";
import { dueCards, reviewCard, addCard, removeCard, generateCards, cardStats, type Grade } from "../lib/cards";
import { toast } from "../lib/toast";
import Guide from "./Guide";

const GRADES: { g: Grade; label: string; color: string }[] = [
  { g: "again", label: "Nie pamiętam", color: "#ff8585" },
  { g: "hard", label: "Trudne", color: "var(--gold)" },
  { g: "good", label: "Dobre", color: "var(--cyan)" },
  { g: "easy", label: "Łatwe", color: "var(--ok, #58e08a)" },
];

export default function Cards({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const stats = useMemo(() => cardStats(), [data.flashcards]);

  const [mode, setMode] = useState<"home" | "review" | "make">("home");
  const [queue, setQueue] = useState<string[]>([]);
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(0);

  // Generator
  const [material, setMaterial] = useState("");
  const [deck, setDeck] = useState("");
  const [busy, setBusy] = useState(false);
  // Ręczna
  const [mFront, setMFront] = useState("");
  const [mBack, setMBack] = useState("");

  const startReview = () => {
    const ids = dueCards().map((c) => c.id);
    if (!ids.length) {
      toast("Brak fiszek do powtórki — wróć później albo dodaj nowe.");
      return;
    }
    setQueue(ids);
    setShow(false);
    setDone(0);
    setMode("review");
  };

  const current = useMemo(() => data.flashcards.find((c) => c.id === queue[0]), [queue, data.flashcards]);

  const grade = (g: Grade) => {
    if (!current) return;
    reviewCard(current.id, g);
    setDone((d) => d + 1);
    setShow(false);
    setQueue((q) => q.slice(1));
  };

  const make = async () => {
    if (!material.trim()) {
      toast("Wklej materiał albo wpisz temat.");
      return;
    }
    setBusy(true);
    const r = await generateCards(material, deck || undefined, "ręcznie");
    setBusy(false);
    if ("error" in r) {
      toast(r.error);
    } else {
      toast(`Dodałem ${r.added} fiszek ✓`);
      setMaterial("");
      setMode("home");
    }
  };

  const addManual = () => {
    if (!mFront.trim() || !mBack.trim()) {
      toast("Uzupełnij pytanie i odpowiedź.");
      return;
    }
    addCard(mFront, mBack, deck || undefined, "ręcznie");
    setMFront("");
    setMBack("");
    toast("Fiszka dodana ✓");
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🧠 Kapsuły Wiedzy</h2>
        </div>
        <div className="panel-body">
          {mode === "home" && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--cyan)" }}>{stats.due}</div>
                  <div className="muted" style={{ fontSize: 11 }}>do powtórki</div>
                </div>
                <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--ok, #58e08a)" }}>{stats.learned}</div>
                  <div className="muted" style={{ fontSize: 11 }}>w pamięci</div>
                </div>
                <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--gold)" }}>{stats.total}</div>
                  <div className="muted" style={{ fontSize: 11 }}>fiszek</div>
                </div>
              </div>

              <button className="btn primary" onClick={startReview} disabled={stats.due === 0}>
                {stats.due ? `▶ Powtórz teraz (${stats.due})` : "✅ Na dziś powtórzone"}
              </button>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => setMode("make")}>✨ Stwórz fiszki</button>
              </div>

              <Guide title="ℹ Jak to działa (i dlaczego działa)">
                <p>JARVIS odpytuje Cię z fiszek w <b>rosnących odstępach czasu</b> (algorytm SM-2, jak Anki). Im lepiej pamiętasz, tym rzadziej pyta — tak wiedza ląduje w pamięci długotrwałej.</p>
                <p>To nie trik, tylko najlepiej udowodniona technika nauki (aktywne przypominanie + spacing). Fiszki tworzysz ręcznie, wklejając materiał, albo prosząc w czacie: <b>„zrób fiszki z tego"</b>.</p>
              </Guide>

              {data.flashcards.length > 0 && (
                <>
                  <h3 style={{ marginTop: 14 }}>Ostatnie fiszki</h3>
                  {data.flashcards.slice(0, 8).map((c) => (
                    <div key={c.id} className="journal-card">
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <b style={{ fontSize: 14 }}>{c.front}</b>
                        <span className="x" style={{ cursor: "pointer" }} onClick={() => removeCard(c.id)}>✕</span>
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>{c.back}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {mode === "review" && (
            current ? (
              <div style={{ textAlign: "center" }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Zostało {queue.length} · powtórzone {done}</div>
                <div
                  className="journal-card"
                  style={{ minHeight: "26vh", display: "flex", flexDirection: "column", justifyContent: "center", cursor: "pointer", padding: 20 }}
                  onClick={() => setShow(true)}
                >
                  <div style={{ fontSize: 19, fontWeight: 600 }}>{current.front}</div>
                  {show ? (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)", fontSize: 17 }}>{current.back}</div>
                  ) : (
                    <div className="muted" style={{ marginTop: 14, fontSize: 13 }}>Dotknij, by zobaczyć odpowiedź</div>
                  )}
                </div>
                {show && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                    {GRADES.map((x) => (
                      <button key={x.g} className="btn" style={{ borderColor: x.color, color: x.color }} onClick={() => grade(x.g)}>
                        {x.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: 40 }}>🎉</div>
                <h3>Sesja ukończona — {done} {done === 1 ? "fiszka" : "fiszek"}!</h3>
                <p className="muted">Świetnie. Wróć, gdy kolejne będą gotowe do powtórki.</p>
                <button className="btn primary" onClick={() => setMode("home")}>Wróć</button>
              </div>
            )
          )}

          {mode === "make" && (
            <>
              <h3>✨ Stwórz fiszki z materiału</h3>
              <p className="muted" style={{ fontSize: 13 }}>Wklej notatki, fragment artykułu albo wpisz temat — AI zrobi z tego fiszki.</p>
              <div className="field">
                <input value={deck} placeholder="Temat / talia (opcjonalnie)" onChange={(e) => setDeck(e.target.value)} />
              </div>
              <div className="field">
                <textarea className="ta" style={{ minHeight: 120 }} value={material} placeholder="Wklej materiał albo wpisz temat…" onChange={(e) => setMaterial(e.target.value)} />
              </div>
              <button className="btn primary" onClick={make} disabled={busy}>{busy ? "Tworzę…" : "🧠 Generuj fiszki AI"}</button>

              <h3 style={{ marginTop: 16 }}>➕ Albo dodaj ręcznie</h3>
              <div className="field"><input value={mFront} placeholder="Pytanie" onChange={(e) => setMFront(e.target.value)} /></div>
              <div className="field"><input value={mBack} placeholder="Odpowiedź" onChange={(e) => setMBack(e.target.value)} /></div>
              <button className="btn" onClick={addManual}>Dodaj fiszkę</button>

              <button className="btn" style={{ marginTop: 14 }} onClick={() => setMode("home")}>← Wróć</button>
            </>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
