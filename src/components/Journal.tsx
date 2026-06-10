import { useMemo, useState } from "react";
import { store, uid } from "../lib/store";
import { useStore } from "../hooks/useStore";
import type { JournalEntry } from "../types";

// Osobisty dziennik — przejrzysta baza przemyśleń. Oddzielne wpisy (nie jeden ciąg),
// z tytułem, tagami i wyszukiwaniem. Można wyeksportować do pliku (np. pod książkę).

const fmtDate = (t: number) =>
  new Date(t).toLocaleString("pl-PL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function exportMarkdown(entries: JournalEntry[]) {
  const md =
    `# Mój dziennik\n\n_${entries.length} wpisów · eksport ${new Date().toLocaleDateString("pl-PL")}_\n\n` +
    [...entries]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((e) => {
        const tags = e.tags?.length ? `\n_Tagi: ${e.tags.join(", ")}_` : "";
        const mood = e.mood ? ` · nastrój: ${e.mood}` : "";
        return `## ${e.title || "Bez tytułu"}\n_${fmtDate(e.createdAt)}${mood}_${tags}\n\n${e.body}\n`;
      })
      .join("\n---\n\n");
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `moj-dziennik-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function Journal({ onClose }: { onClose: () => void }) {
  const { data } = useStore();
  const entries = data.journal || [];
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("");
  const [editing, setEditing] = useState<JournalEntry | "new" | null>(null);

  // Lokalny stan edytora.
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [mood, setMood] = useState("");

  const openNew = () => {
    setTitle("");
    setBody("");
    setTags("");
    setMood("");
    setEditing("new");
  };
  const openEdit = (e: JournalEntry) => {
    setTitle(e.title);
    setBody(e.body);
    setTags((e.tags || []).join(", "));
    setMood(e.mood || "");
    setEditing(e);
  };

  const parseTags = (s: string) =>
    s.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10);

  const saveEntry = () => {
    if (!body.trim() && !title.trim()) {
      setEditing(null);
      return;
    }
    const t = parseTags(tags);
    if (editing === "new") {
      store.setData((d) =>
        d.journal.unshift({
          id: uid(),
          title: title.trim(),
          body: body.trim(),
          tags: t,
          mood: mood.trim() || undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    } else if (editing) {
      const id = editing.id;
      store.setData((d) => {
        const e = d.journal.find((x) => x.id === id);
        if (e) {
          e.title = title.trim();
          e.body = body.trim();
          e.tags = t;
          e.mood = mood.trim() || undefined;
          e.updatedAt = Date.now();
        }
      });
    }
    setEditing(null);
  };

  const delEntry = (id: string) =>
    store.setData((d) => {
      d.journal = d.journal.filter((x) => x.id !== id);
    });

  const allTags = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => (e.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (activeTag && !(e.tags || []).includes(activeTag)) return false;
      if (!q) return true;
      return (e.title + " " + e.body + " " + (e.tags || []).join(" ")).toLowerCase().includes(q);
    });
  }, [entries, query, activeTag]);

  // --- Widok edytora ---
  if (editing) {
    return (
      <div className="sheet" onClick={onClose}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <div className="panel-head">
            <div className="grabber" />
            <h2>📔 {editing === "new" ? "Nowy wpis" : "Edycja wpisu"}</h2>
          </div>
          <div className="panel-body">
            <div className="field">
              <input value={title} placeholder="Tytuł (np. Refleksja o…)" onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <textarea
                value={body}
                autoFocus
                placeholder="Tu spisuj swoje przemyślenia… (możesz pisać długo, akapitami)"
                onChange={(e) => setBody(e.target.value)}
                style={{ width: "100%", minHeight: 220, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: 12, fontFamily: "inherit", fontSize: 16, lineHeight: 1.6 }}
              />
            </div>
            <div className="field" style={{ display: "flex", gap: 8 }}>
              <input value={tags} placeholder="Tagi po przecinku (np. rodzina, praca)" onChange={(e) => setTags(e.target.value)} style={{ flex: 2 }} />
              <input value={mood} placeholder="Nastrój" onChange={(e) => setMood(e.target.value)} style={{ flex: 1 }} />
            </div>
          </div>
          <div className="panel-foot" style={{ display: "flex", gap: 8 }}>
            {editing !== "new" && (
              <button
                className="btn"
                style={{ flex: 1 }}
                onClick={() => {
                  delEntry(editing.id);
                  setEditing(null);
                }}
              >
                🗑 Usuń
              </button>
            )}
            <button className="btn" style={{ flex: 1 }} onClick={() => setEditing(null)}>
              Anuluj
            </button>
            <button className="btn primary" style={{ flex: 1 }} onClick={saveEntry}>
              💾 Zapisz
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Widok listy ---
  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📔 Mój dziennik</h2>
        </div>
        <div className="panel-body">
          <div className="field" style={{ display: "flex", gap: 8 }}>
            <input value={query} placeholder="Szukaj w dzienniku…" onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
            <button className="btn primary" style={{ width: "auto", marginTop: 0 }} onClick={openNew}>
              ＋ Nowy
            </button>
          </div>

          {allTags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0 10px" }}>
              <span className={`chip ${!activeTag ? "on" : ""}`} onClick={() => setActiveTag("")} style={{ cursor: "pointer" }}>
                wszystkie
              </span>
              {allTags.map((t) => (
                <span key={t} className={`chip ${activeTag === t ? "on" : ""}`} onClick={() => setActiveTag(activeTag === t ? "" : t)} style={{ cursor: "pointer" }}>
                  #{t}
                </span>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>
              {entries.length === 0
                ? "Twój dziennik jest pusty. Kliknij ＋ Nowy i zacznij spisywać przemyślenia — to Twoja prywatna przestrzeń."
                : "Brak wpisów pasujących do filtra."}
            </p>
          ) : (
            filtered.map((e) => (
              <div key={e.id} className="journal-card" onClick={() => openEdit(e)} style={{ cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <b style={{ fontSize: 16 }}>{e.title || "Bez tytułu"}</b>
                  <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(e.createdAt)}</span>
                </div>
                <p className="muted" style={{ margin: "6px 0 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {e.body || "(pusty)"}
                </p>
                {(e.tags || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {e.mood && <span className="chip">🙂 {e.mood}</span>}
                    {e.tags.map((t) => (
                      <span key={t} className="chip">#{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div className="panel-foot" style={{ display: "flex", gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => exportMarkdown(entries)} disabled={!entries.length}>
            ⬇ Eksportuj (.md)
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
