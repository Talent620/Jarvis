import { useState } from "react";
import { runGoal, type GoalStep } from "../lib/goalPlanner";
import Modal from "./Modal";

// „Zleć cel" — do-for-me: złożony cel → JARVIS rozkłada na kroki, wykonuje równolegle wg zależności
// i syntetyzuje spójną odpowiedź. Wykonanie używa rozumowania modelu (bez akcji wychodzących).
const STATUS_ICON: Record<string, string> = { pending: "○", start: "⏳", done: "✅", fail: "⚠", skip: "⤼" };

const EXAMPLES = [
  "Przygotuj plan wejścia na rynek: 3 kanały, budżet i pierwsze kroki na 30 dni",
  "Zaplanuj tydzień pracy nad projektem X z kamieniami milowymi i ryzykami",
  "Rozpisz strategię pozyskania 10 klientów dla mojej niszy",
];

export default function GoalRunner({ onClose }: { onClose: () => void }) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<GoalStep[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState("");

  const run = async (g0?: string) => {
    const g = (g0 ?? goal).trim();
    if (busy || !g) return;
    if (g0) setGoal(g0);
    setBusy(true); setErr(""); setAnswer(""); setSteps([]); setStatus({});
    try {
      const r = await runGoal(g, {
        onPlan: (pl) => { setSteps(pl); setStatus(Object.fromEntries(pl.map((s) => [s.id, "pending"]))); },
        onEvent: (e) => setStatus((s) => ({ ...s, [e.id]: e.type })),
      });
      setSteps(r.steps);
      setAnswer(r.answer || "Gotowe.");
    } catch {
      setErr("Nie udało się zrealizować celu — sprawdź, czy mózg AI odpowiada (otwórz 🛡 Strażnika).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="🎯 Zleć cel"
      onClose={onClose}
      foot={<button className="btn" onClick={onClose}>Zamknij</button>}
    >
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Podaj złożony cel — JARVIS sam <b>rozłoży go na kroki</b>, wykona je równolegle (wg
            zależności) i <b>zsyntetyzuje jedną spójną odpowiedź</b>. „Zrób za mnie", nie tylko „odpowiedz".
          </p>
          <div className="field">
            <textarea
              className="ta"
              style={{ minHeight: 80 }}
              value={goal}
              placeholder="np. Przygotuj plan wejścia na rynek z 3 kanałami, budżetem i pierwszymi krokami na 30 dni"
              onChange={(e) => setGoal(e.target.value)}
              disabled={busy}
            />
          </div>
          {!steps.length && !busy && (
            <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" onClick={() => void run(ex)}>{ex.slice(0, 38)}…</button>
              ))}
            </div>
          )}
          <button className="btn primary" style={{ width: "100%" }} disabled={busy || !goal.trim()} onClick={() => void run()}>
            {busy ? "⏳ Planuję i wykonuję…" : "🎯 Zleć cel"}
          </button>

          {steps.length > 0 && (
            <div className="journal-card" style={{ padding: "10px 12px", marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>🧩 Plan ({steps.length} kroków)</div>
              {steps.map((s) => (
                <div key={s.id} style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                  {STATUS_ICON[status[s.id] || "pending"]} {s.task}
                  {s.deps.length ? <span className="muted"> · po: {s.deps.join(", ")}</span> : null}
                </div>
              ))}
            </div>
          )}

          {err && <p className="notice">⚠ {err}</p>}

          {answer && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontWeight: 700, color: "var(--cyan)", margin: "0 0 4px" }}>✅ Wynik:</p>
              <div className="journal-card" style={{ padding: "10px 12px", whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6 }}>{answer}</div>
            </div>
          )}
    </Modal>
  );
}
