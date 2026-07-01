import { useMemo, useState } from "react";
import { store, uid } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { parseQuickTask, nextRepeat } from "../lib/taskParser";
import { gcalEventUrl } from "../lib/glinks";
import { useEscape } from "../hooks/useEscape";
import type { Task } from "../types";

// Centrum Zadań w stylu Nozbe (GTD): Priorytet (dzisiejszy fokus), Dziś,
// Skrzynka (bez projektu), Projekty. Szybkie dodawanie z naturalnym zapisem:
//   "Zadzwoń do klienta #Strona-Kowalski @telefon ! jutro +Marek"

type View = "priority" | "today" | "inbox" | "projects" | "done";

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function TaskHub({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const tasks = useMemo(() => data.tasks || [], [data.tasks]);
  const projects = data.projects || [];
  const [view, setView] = useState<View>("priority");
  const [activeProject, setActiveProject] = useState<string>("");
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState<string>("");
  const today = todayISO();

  // Dopasuj projekt po nazwie (fragment, bez wielkości liter) albo utwórz nowy.
  const resolveProject = (name?: string): string | undefined => {
    if (!name?.trim()) return undefined;
    const found = projects.find((p) => p.name.toLowerCase() === name.toLowerCase())
      || projects.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
    if (found) return found.id;
    const id = uid();
    store.setData((d) => d.projects.unshift({ id, name: name.trim(), instructions: "", createdAt: Date.now(), updatedAt: Date.now() }));
    return id;
  };

  const add = () => {
    const p = parseQuickTask(input);
    if (!p.title) return;
    const projectId = resolveProject(p.projectName) || (view === "projects" && activeProject ? activeProject : undefined);
    store.setData((d) =>
      d.tasks.unshift({
        id: uid(), title: p.title, done: false,
        due: p.due || (view === "today" ? today : undefined),
        owner: p.owner, priority: p.priority || view === "priority",
        projectId, category: p.category, repeat: p.repeat, createdAt: Date.now(),
      }),
    );
    setInput("");
  };

  const patch = (id: string, x: Partial<Task>) =>
    store.setData((d) => { const t = d.tasks.find((y) => y.id === id); if (t) Object.assign(t, x); });

  // Wykonanie: powtarzalne wraca z nowym terminem; reszta zostaje odhaczona.
  const toggle = (t: Task) => {
    if (!t.done && t.repeat) {
      store.setData((d) => { const x = d.tasks.find((y) => y.id === t.id); if (x) x.due = nextRepeat(x.due, x.repeat!); });
    } else patch(t.id, { done: !t.done });
  };
  const del = (id: string) => store.setData((d) => { d.tasks = d.tasks.filter((x) => x.id !== id); });

  const projName = (id?: string) => projects.find((p) => p.id === id)?.name;

  const list = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    if (view === "priority") return open.filter((t) => t.priority);
    if (view === "today") return open.filter((t) => t.due && t.due.slice(0, 10) <= today);
    if (view === "inbox") return open.filter((t) => !t.projectId);
    if (view === "projects") return open.filter((t) => t.projectId === activeProject);
    return tasks.filter((t) => t.done).slice(0, 40);
  }, [tasks, view, activeProject, today]);

  const counts = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    return {
      priority: open.filter((t) => t.priority).length,
      today: open.filter((t) => t.due && t.due.slice(0, 10) <= today).length,
      inbox: open.filter((t) => !t.projectId).length,
    };
  }, [tasks, today]);

  const TABS: { id: View; label: string; n?: number }[] = [
    { id: "priority", label: "⭐ Priorytet", n: counts.priority },
    { id: "today", label: "📅 Dziś", n: counts.today },
    { id: "inbox", label: "📥 Skrzynka", n: counts.inbox },
    { id: "projects", label: "📁 Projekty" },
    { id: "done", label: "✓ Zrobione" },
  ];

  const Row = ({ t }: { t: Task }) => {
    const overdue = !t.done && t.due && t.due.slice(0, 10) < today;
    return (
      <div className="journal-card" style={{ padding: "8px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={t.done} onChange={() => toggle(t)} style={{ width: 18, height: 18 }} />
          <span
            onClick={() => patch(t.id, { priority: !t.priority })}
            title="Priorytet (gwiazdka)"
            style={{ cursor: "pointer", fontSize: 16, opacity: t.priority ? 1 : 0.3 }}
          >⭐</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ textDecoration: t.done ? "line-through" : "none", fontSize: 14 }}>{t.title}</div>
            <div className="muted" style={{ fontSize: 11, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {projName(t.projectId) && <span>📁 {projName(t.projectId)}</span>}
              {t.category && <span>@{t.category}</span>}
              {t.owner && <span>👤 {t.owner}</span>}
              {t.repeat && <span>🔁 {t.repeat === "daily" ? "codziennie" : t.repeat === "weekly" ? "co tydzień" : "co miesiąc"}</span>}
              {t.due && <span style={{ color: overdue ? "#e08558" : undefined }}>{overdue ? "⏰ " : "📅 "}{t.due.slice(0, 10)}</span>}
            </div>
          </div>
          <button className="chip" onClick={() => setEditing(editing === t.id ? "" : t.id)}>⋯</button>
          {t.due && (
            <button className="chip" title="Do Kalendarza Google" onClick={() => window.open(gcalEventUrl(t.title, t.owner ? `Odpowiada: ${t.owner}` : "", t.due), "_blank", "noopener")}>📅</button>
          )}
          <button type="button" className="x" aria-label="Usuń zadanie" title="Usuń zadanie" style={{ cursor: "pointer" }} onClick={() => del(t.id)}>✕</button>
        </div>
        {editing === t.id && (
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input type="date" value={t.due?.slice(0, 10) || ""} onChange={(e) => patch(t.id, { due: e.target.value || undefined })}
                style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "2px 6px", fontSize: 12 }} />
              <input value={t.owner || ""} placeholder="kto?" onChange={(e) => patch(t.id, { owner: e.target.value || undefined })}
                style={{ width: 90, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "2px 6px", fontSize: 12 }} />
              <input value={t.category || ""} placeholder="@kontekst" onChange={(e) => patch(t.id, { category: e.target.value.replace(/^@/, "") || undefined })}
                style={{ width: 100, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "2px 6px", fontSize: 12 }} />
              <select value={t.projectId || ""} onChange={(e) => patch(t.id, { projectId: e.target.value || undefined })}
                style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "2px 6px", fontSize: 12 }}>
                <option value="">📥 Skrzynka</option>
                {projects.map((p) => <option key={p.id} value={p.id}>📁 {p.name}</option>)}
              </select>
              <select value={t.repeat || ""} onChange={(e) => patch(t.id, { repeat: (e.target.value || undefined) as Task["repeat"] })}
                style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "2px 6px", fontSize: 12 }}>
                <option value="">bez powtórek</option>
                <option value="daily">codziennie</option>
                <option value="weekly">co tydzień</option>
                <option value="monthly">co miesiąc</option>
              </select>
            </div>
            <textarea value={t.notes || ""} placeholder="Notatki / komentarze do zadania…" onChange={(e) => patch(t.id, { notes: e.target.value || undefined })}
              className="ta" style={{ minHeight: 56, fontSize: 13 }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>✅ Zadania Pro</h2>
        </div>
        <div className="panel-body">
          {/* Szybkie dodawanie */}
          <div className="field" style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              placeholder="Dodaj: Zadzwoń do klienta #Projekt @telefon ! jutro +Marek"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              style={{ flex: 1 }}
            />
            <button className="btn primary" onClick={add}>➕</button>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: -4 }}>
            <b>#</b> projekt · <b>@</b> kontekst · <b>+</b> osoba · <b>!</b> priorytet · <b>dziś/jutro/pon/12.08</b> termin · <b>*tydzień</b> powtarzanie
          </p>

          {/* Zakładki */}
          <div className="chips" style={{ flexWrap: "wrap", margin: "6px 0 10px" }}>
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`chip ${view === t.id ? "on" : ""}`} aria-pressed={view === t.id} onClick={() => setView(t.id)}>
                {t.label}{t.n ? ` (${t.n})` : ""}
              </button>
            ))}
          </div>

          {/* Wybór projektu */}
          {view === "projects" && (
            <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
              {projects.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Brak projektów — dodaj zadanie z <b>#NazwaProjektu</b>, a utworzę go automatycznie.</span>}
              {projects.map((p) => {
                const n = tasks.filter((t) => !t.done && t.projectId === p.id).length;
                return (
                  <button key={p.id} type="button" className={`chip ${activeProject === p.id ? "on" : ""}`} aria-pressed={activeProject === p.id} onClick={() => setActiveProject(p.id)}>
                    📁 {p.name} ({n})
                  </button>
                );
              })}
            </div>
          )}

          {/* Lista */}
          {list.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: "16px 0" }}>
              {view === "priority" ? "Brak zadań-priorytetów. Oznacz gwiazdką to, na czym dziś się skupiasz."
                : view === "today" ? "Nic na dziś. Czysto! ✨"
                : view === "done" ? "Jeszcze nic nie zrobione."
                : "Pusto tutaj."}
            </p>
          ) : (
            list.map((t) => <Row key={t.id} t={t} />)
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
