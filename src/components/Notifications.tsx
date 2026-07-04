import { useStore } from "../hooks/useStore";
import { dueReminders, soonReminders, notifySummary, dismissReminder } from "../lib/notifyCenter";
import { proactiveSuggestions } from "../lib/proactivity";
import Modal from "./Modal";

// Centrum powiadomień — jedno miejsce z tym, co wymaga uwagi: przypomnienia
// po czasie, zaplanowane na dziś, oraz skróty do zadań, follow-upów i fiszek.
export default function Notifications({
  onClose, onTasks, onSales, onCards,
}: {
  onClose: () => void;
  onTasks?: () => void;
  onSales?: () => void;
  onCards?: () => void;
}) {
  useStore(); // odśwież po odhaczeniu
  const now = Date.now();
  const due = dueReminders(now);
  const soon = soonReminders(now);
  const s = notifySummary(now);
  const suggestions = proactiveSuggestions(now);

  const time = (iso: string) => new Date(iso).toLocaleString("pl-PL", { weekday: "short", hour: "2-digit", minute: "2-digit" });

  const chips: { show: boolean; icon: string; label: string; n: number; fn?: () => void }[] = [
    { show: s.tasksToday > 0, icon: "✅", label: "zadań na dziś/zaległych", n: s.tasksToday, fn: onTasks },
    { show: s.followUps > 0, icon: "🔁", label: "follow-upów w sprzedaży", n: s.followUps, fn: onSales },
    { show: s.cards > 0, icon: "🧠", label: "fiszek do powtórki", n: s.cards, fn: onCards },
  ];

  return (
    <Modal
      title="🔔 Powiadomienia"
      onClose={onClose}
      foot={<button className="btn" onClick={onClose}>Zamknij</button>}
    >
          {/* Proaktywne propozycje JARVIS-a (Faza 7) */}
          {suggestions.length > 0 && (
            <>
              <h3 style={{ marginTop: 0 }}>💡 Propozycje JARVIS-a</h3>
              {suggestions.map((sg) => (
                <div key={sg.id} className="journal-card" style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 14 }}>{sg.icon} {sg.text}</div>
                </div>
              ))}
            </>
          )}

          {/* Przypomnienia po czasie */}
          {due.length > 0 && (
            <>
              <h3 style={{ color: "#e08558" }}>⏰ Przypomnienia ({due.length})</h3>
              {due.map((r) => (
                <div key={r.id} className="journal-card" style={{ padding: "8px 10px", display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14 }}>{r.text}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{time(r.at)}</div>
                  </div>
                  <button className="chip" onClick={() => dismissReminder(r.id)}>✓ OK</button>
                </div>
              ))}
            </>
          )}

          {/* Zaplanowane na dziś */}
          {soon.length > 0 && (
            <>
              <h3>📅 Dziś jeszcze ({soon.length})</h3>
              {soon.map((r) => (
                <div key={r.id} className="journal-card" style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 14 }}>{r.text}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{time(r.at)}</div>
                </div>
              ))}
            </>
          )}

          {/* Skróty do tego, co czeka */}
          {chips.some((c) => c.show) && (
            <>
              <h3 style={{ marginTop: 14 }}>📌 Czeka na Ciebie</h3>
              {chips.filter((c) => c.show).map((c) => (
                <div key={c.label} className="journal-card" style={{ padding: "8px 10px", display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>{c.icon} <b>{c.n}</b> {c.label}</div>
                  {c.fn && <button className="chip" onClick={() => { c.fn!(); onClose(); }}>Otwórz</button>}
                </div>
              ))}
            </>
          )}

          {due.length === 0 && soon.length === 0 && !chips.some((c) => c.show) && suggestions.length === 0 && (
            <p className="muted" style={{ textAlign: "center", padding: "20px 0" }}>
              Czysto! Nic nie wymaga teraz Twojej uwagi. ✨
            </p>
          )}
    </Modal>
  );
}
