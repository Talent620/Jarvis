import { useMemo, useState } from "react";
import { store, uid } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { gcalEventUrl } from "../lib/glinks";
import { useEscape } from "../hooks/useEscape";
import type { Task } from "../types";

// Plan Dnia — dowództwo poranka: co dziś trzeba zrobić, KTO za to odpowiada,
// notatnik dnia i jeden klik do Kalendarza Google. Korzysta z istniejących
// zadań (Dane → Zadania) — wszystko spójne i zsynchronizowane.

const todayISO = () => new Date().toISOString().slice(0, 10);
const NOTE_PREFIX = "📅 Plan dnia ";

export default function DayPlan({ onClose, onSales }: { onClose: () => void; onSales?: () => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const today = todayISO();
  const [form, setForm] = useState({ title: "", owner: "", due: today });

  // Notatnik dnia: jedna notatka per data (w zwykłych Notatkach — synchronizuje się).
  const dayNote = data.notes.find((n) => n.text.startsWith(NOTE_PREFIX + today));
  const noteBody = dayNote ? dayNote.text.slice((NOTE_PREFIX + today + "\n").length) : "";
  const saveNote = (text: string) =>
    store.setData((d) => {
      const existing = d.notes.find((n) => n.text.startsWith(NOTE_PREFIX + today));
      if (existing) {
        if (text.trim()) existing.text = `${NOTE_PREFIX}${today}\n${text}`;
        else d.notes = d.notes.filter((n) => n.id !== existing.id);
      } else if (text.trim()) {
        d.notes.unshift({ id: uid(), text: `${NOTE_PREFIX}${today}\n${text}`, createdAt: Date.now() });
      }
    });

  // Zadania dnia: zaległe + na dziś + bez terminu (otwarte). Zaległe na górze.
  const { overdue, todays, someday, doneToday } = useMemo(() => {
    const t = data.tasks || [];
    const isToday = (x: Task) => (x.due || "").slice(0, 10) === today;
    const isPast = (x: Task) => !!x.due && x.due.slice(0, 10) < today;
    return {
      overdue: t.filter((x) => !x.done && isPast(x)),
      todays: t.filter((x) => !x.done && isToday(x)),
      someday: t.filter((x) => !x.done && !x.due),
      doneToday: t.filter((x) => x.done && (isToday(x) || !x.due)).slice(0, 8),
    };
  }, [data.tasks, today]);

  const toggle = (id: string) =>
    store.setData((d) => {
      const x = d.tasks.find((y) => y.id === id);
      if (x) x.done = !x.done;
    });
  const del = (id: string) => store.setData((d) => { d.tasks = d.tasks.filter((x) => x.id !== id); });
  const moveToToday = (id: string) =>
    store.setData((d) => {
      const x = d.tasks.find((y) => y.id === id);
      if (x) x.due = today;
    });

  const add = () => {
    const title = form.title.trim();
    if (!title) return;
    store.setData((d) =>
      d.tasks.unshift({ id: uid(), title, owner: form.owner.trim() || undefined, due: form.due || undefined, done: false, createdAt: Date.now() }),
    );
    setForm({ title: "", owner: form.owner, due: today }); // owner zostaje — często dodajesz kilka dla tej samej osoby
  };

  const TaskRow = ({ t, late }: { t: Task; late?: boolean }) => (
    <div className="journal-card" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
      <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} style={{ width: 18, height: 18 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ textDecoration: t.done ? "line-through" : "none", fontSize: 14 }}>
          {late && "⏰ "}{t.title}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {t.owner ? `👤 ${t.owner}` : "👤 Ja"}{t.due ? ` · ${t.due.slice(0, 10)}` : ""}
        </div>
      </div>
      {!t.done && !t.due && <button className="chip" onClick={() => moveToToday(t.id)}>→ dziś</button>}
      <button
        className="chip"
        title="Dodaj do Kalendarza Google"
        onClick={() => window.open(gcalEventUrl(t.title, t.owner ? `Odpowiada: ${t.owner}` : "", t.due || today), "_blank", "noopener")}
      >📅</button>
      <span className="x" style={{ cursor: "pointer" }} onClick={() => del(t.id)}>✕</span>
    </div>
  );

  const dateLabel = new Date().toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🗓 Plan Dnia</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, textTransform: "capitalize" }}>{dateLabel}</p>

          {/* Szybkie dodanie: co + kto + kiedy */}
          <div className="field" style={{ display: "flex", gap: 8 }}>
            <input
              value={form.title}
              placeholder="Co trzeba zrobić?"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && add()}
              style={{ flex: 2 }}
            />
          </div>
          <div className="field" style={{ display: "flex", gap: 8 }}>
            <input
              value={form.owner}
              placeholder="Kto odpowiada? (puste = Ja)"
              onChange={(e) => setForm({ ...form, owner: e.target.value })}
              style={{ flex: 1 }}
            />
            <input
              type="date"
              value={form.due}
              onChange={(e) => setForm({ ...form, due: e.target.value })}
              style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "0 8px" }}
            />
            <button className="btn primary" onClick={add}>➕</button>
          </div>

          {overdue.length > 0 && (
            <>
              <h3 style={{ color: "#e08558" }}>⏰ Zaległe ({overdue.length})</h3>
              {overdue.map((t) => <TaskRow key={t.id} t={t} late />)}
            </>
          )}

          <h3>✅ Na dziś ({todays.length})</h3>
          {todays.length ? todays.map((t) => <TaskRow key={t.id} t={t} />) : (
            <p className="muted" style={{ fontSize: 13 }}>Nic zaplanowanego — dodaj wyżej albo przeciągnij z „Kiedyś" (→ dziś).</p>
          )}

          {someday.length > 0 && (
            <>
              <h3>📥 Bez terminu ({someday.length})</h3>
              {someday.slice(0, 6).map((t) => <TaskRow key={t.id} t={t} />)}
            </>
          )}

          {doneToday.length > 0 && (
            <>
              <h3 style={{ opacity: 0.7 }}>🏁 Zrobione</h3>
              {doneToday.map((t) => <TaskRow key={t.id} t={t} />)}
            </>
          )}

          {/* Notatnik dnia */}
          <h3 style={{ marginTop: 14 }}>📝 Notatnik dnia</h3>
          <textarea
            className="ta"
            style={{ minHeight: "16vh", fontSize: 14 }}
            placeholder="Luźne myśli, ustalenia z rozmów, rzeczy do ogarnięcia…"
            defaultValue={noteBody}
            onBlur={(e) => saveNote(e.target.value)}
          />
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Zapisuje się automatycznie (osobna notatka na każdy dzień — znajdziesz je też w ▣ Dane → Notatki).
          </p>

          {onSales && (
            <button className="btn" style={{ marginTop: 10 }} onClick={onSales}>
              📈 Przejdź do leadów (Pulpit Sprzedaży)
            </button>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
