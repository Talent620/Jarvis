import { useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";

type Tab = "tasks" | "notes" | "reminders" | "shopping" | "calendar" | "memory";

const TABS: { id: Tab; label: string }[] = [
  { id: "tasks", label: "Zadania" },
  { id: "notes", label: "Notatki" },
  { id: "reminders", label: "Przypomnienia" },
  { id: "shopping", label: "Zakupy" },
  { id: "calendar", label: "Kalendarz" },
  { id: "memory", label: "Pamięć" },
];

export default function Panels({ onClose }: { onClose: () => void }) {
  const { data } = useStore();
  const [tab, setTab] = useState<Tab>("tasks");

  const remove = (kind: Tab, id: string) =>
    store.setData((d) => {
      (d[kind] as { id: string }[]) = (d[kind] as { id: string }[]).filter((x) => x.id !== id);
    });

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>▣ Twoje dane</h2>
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "tasks" &&
          (data.tasks.length ? (
            data.tasks.map((t) => (
              <div key={t.id} className={`list-item ${t.done ? "done" : ""}`}>
                <span
                  style={{ cursor: "pointer" }}
                  onClick={() => store.setData((d) => {
                    const x = d.tasks.find((y) => y.id === t.id);
                    if (x) x.done = !x.done;
                  })}
                >
                  {t.done ? "✓" : "○"}
                </span>
                <span>
                  {t.title}
                  {t.due ? `  ·  ${new Date(t.due).toLocaleString("pl-PL")}` : ""}
                </span>
                <span className="x" onClick={() => remove("tasks", t.id)}>
                  ✕
                </span>
              </div>
            ))
          ) : (
            <p className="muted">Brak zadań.</p>
          ))}

        {tab === "notes" &&
          (data.notes.length ? (
            data.notes.map((n) => (
              <div key={n.id} className="list-item">
                <span>📝 {n.text}</span>
                <span className="x" onClick={() => remove("notes", n.id)}>
                  ✕
                </span>
              </div>
            ))
          ) : (
            <p className="muted">Brak notatek.</p>
          ))}

        {tab === "reminders" &&
          (data.reminders.length ? (
            data.reminders.map((r) => (
              <div key={r.id} className="list-item">
                <span>
                  ⏰ {r.text} · {new Date(r.at).toLocaleString("pl-PL")}
                </span>
                <span className="x" onClick={() => remove("reminders", r.id)}>
                  ✕
                </span>
              </div>
            ))
          ) : (
            <p className="muted">Brak przypomnień.</p>
          ))}

        {tab === "shopping" &&
          (data.shopping.length ? (
            data.shopping.map((s) => (
              <div key={s.id} className={`list-item ${s.done ? "done" : ""}`}>
                <span
                  style={{ cursor: "pointer" }}
                  onClick={() => store.setData((d) => {
                    const x = d.shopping.find((y) => y.id === s.id);
                    if (x) x.done = !x.done;
                  })}
                >
                  {s.done ? "✓" : "○"}
                </span>
                <span>
                  {s.qty ? `${s.qty} ` : ""}
                  {s.name}
                </span>
                <span className="x" onClick={() => remove("shopping", s.id)}>
                  ✕
                </span>
              </div>
            ))
          ) : (
            <p className="muted">Lista zakupów pusta.</p>
          ))}

        {tab === "calendar" &&
          (data.calendar.length ? (
            [...data.calendar]
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((e) => (
                <div key={e.id} className="list-item">
                  <span>
                    📅 {new Date(e.start).toLocaleString("pl-PL")} · {e.title}
                    {e.location ? ` @ ${e.location}` : ""}
                  </span>
                  <span className="x" onClick={() => remove("calendar", e.id)}>
                    ✕
                  </span>
                </div>
              ))
          ) : (
            <p className="muted">Kalendarz pusty.</p>
          ))}

        {tab === "memory" &&
          (data.memory.length ? (
            data.memory.map((m) => (
              <div key={m.id} className="list-item">
                <span>
                  🧠 <b>{m.key}</b>: {m.value}
                </span>
                <span className="x" onClick={() => remove("memory", m.id)}>
                  ✕
                </span>
              </div>
            ))
          ) : (
            <p className="muted">JARVIS jeszcze nic o Tobie nie zapamiętał.</p>
          ))}

        <button className="btn" onClick={onClose}>
          Zamknij
        </button>
      </div>
    </div>
  );
}
