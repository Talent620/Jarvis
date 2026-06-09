import { useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { smartHome } from "../lib/deviceControl";
import { undoAction } from "../lib/permissions";

type Tab = "tasks" | "notes" | "reminders" | "shopping" | "tally" | "calendar" | "scenes" | "memory" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "tasks", label: "Zadania" },
  { id: "notes", label: "Notatki" },
  { id: "reminders", label: "Przypomnienia" },
  { id: "shopping", label: "Zakupy" },
  { id: "tally", label: "Targ" },
  { id: "calendar", label: "Kalendarz" },
  { id: "scenes", label: "Sceny" },
  { id: "memory", label: "Pamięć" },
  { id: "audit", label: "Audyt" },
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
        <div className="panel-head">
          <div className="grabber" />
          <h2>▣ Twoje dane</h2>
          <div className="tabs" style={{ marginBottom: 0, marginTop: 12 }}>
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
        </div>
        <div className="panel-body">
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

        {tab === "tally" && (
          <>
            {data.tally.length ? (
              <>
                {data.tally.map((t) => (
                  <div key={t.id} className="list-item">
                    <span>
                      🧾 {t.qty}× {t.name} po {t.unitPrice.toFixed(2)}{" "}
                      <b style={{ color: "var(--gold)" }}>= {(t.qty * t.unitPrice).toFixed(2)}</b>
                    </span>
                    <span className="x" onClick={() => remove("tally", t.id)}>
                      ✕
                    </span>
                  </div>
                ))}
                <div className="list-item" style={{ borderTop: "1px solid var(--line-strong)" }}>
                  <span style={{ fontSize: 17 }}>
                    <b>RAZEM:</b>{" "}
                    <b style={{ color: "var(--gold)" }}>
                      {data.tally.reduce((s, t) => s + t.qty * t.unitPrice, 0).toFixed(2)}
                    </b>{" "}
                    <span className="muted">({data.tally.length} poz.)</span>
                  </span>
                </div>
                <button className="btn" onClick={() => store.setData((d) => { d.tally = []; })}>
                  Wyczyść rachunek
                </button>
              </>
            ) : (
              <p className="muted">
                Pusto. Na targu mów na bieżąco, np. „koszyk truskawek po 15", „dwa pęczki szparagów
                po 8", a potem „podlicz".
              </p>
            )}
          </>
        )}

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

        {tab === "scenes" &&
          (data.scenes.length ? (
            data.scenes.map((s) => (
              <div key={s.id} className="list-item">
                <span
                  style={{ cursor: "pointer", color: "var(--gold)" }}
                  title="Uruchom scenę"
                  onClick={() => s.actions.forEach((a) => void smartHome(a.entityId, a.action))}
                >
                  ▶
                </span>
                <span>
                  {s.name} <span className="muted">({s.actions.length} akcji)</span>
                </span>
                <span className="x" onClick={() => remove("scenes", s.id)}>
                  ✕
                </span>
              </div>
            ))
          ) : (
            <p className="muted">
              Brak scen. Powiedz np.: „Utwórz scenę Dobranoc: zgaś light.salon i włącz switch.alarm".
            </p>
          ))}

        {tab === "memory" &&
          (data.memory.length ? (
            data.memory.map((m) => (
              <div key={m.id} className="list-item">
                <span
                  style={{ cursor: "pointer", color: m.pinned ? "var(--gold)" : "var(--text-dim)" }}
                  title={m.pinned ? "Odepnij" : "Przypnij (zawsze w kontekście)"}
                  onClick={() =>
                    store.setData((d) => {
                      const x = d.memory.find((y) => y.id === m.id);
                      if (x) x.pinned = !x.pinned;
                    })
                  }
                >
                  {m.pinned ? "📌" : "📍"}
                </span>
                <span>
                  <b>{m.key}</b>: {m.value}
                </span>
                <span className="x" onClick={() => remove("memory", m.id)}>
                  ✕
                </span>
              </div>
            ))
          ) : (
            <p className="muted">JARVIS jeszcze nic o Tobie nie zapamiętał.</p>
          ))}

        {tab === "audit" &&
          (data.audit.length ? (
            data.audit.map((a) => (
              <div key={a.id} className="list-item">
                <span>
                  {a.status === "ok" ? "✅" : a.status === "denied" ? "🚫" : "⚠️"} <b>{a.tool}</b>
                  <br />
                  <span className="muted">{new Date(a.at).toLocaleString("pl-PL")}</span>
                </span>
                {a.undo && a.status === "ok" && (
                  <span
                    className="x"
                    style={{ color: "var(--gold)" }}
                    title="Cofnij"
                    onClick={() => undoAction(a)}
                  >
                    ↶
                  </span>
                )}
              </div>
            ))
          ) : (
            <p className="muted">Brak akcji w dzienniku.</p>
          ))}

        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
