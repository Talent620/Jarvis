import { useMemo, useState } from "react";
import { loadChats, saveChats, type ChatSession } from "../lib/chats";
import Modal from "./Modal";

// Historia rozmów — wyszukiwarka, grupowanie po dacie, podgląd ostatniej
// wiadomości i zmiana nazwy. Szybkie odnalezienie i porządek w rozmowach.

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

function bucket(updatedAt: number, now = Date.now()): string {
  const today = startOfDay(now);
  const day = 86400000;
  if (updatedAt >= today) return "Dziś";
  if (updatedAt >= today - day) return "Wczoraj";
  if (updatedAt >= today - 7 * day) return "W tym tygodniu";
  if (updatedAt >= today - 30 * day) return "W tym miesiącu";
  return "Starsze";
}
const ORDER = ["Dziś", "Wczoraj", "W tym tygodniu", "W tym miesiącu", "Starsze"];

function lastSnippet(c: ChatSession): string {
  const last = [...c.messages].reverse().find((m) => m.text?.trim());
  if (!last) return "—";
  const who = last.role === "user" ? "Ty: " : "";
  return (who + last.text.replace(/\s+/g, " ").trim()).slice(0, 80);
}

export default function ChatHistory({
  activeId,
  onOpen,
  onClose,
  onRemoved,
}: {
  activeId: string;
  onOpen: (s: ChatSession) => void;
  onClose: () => void;
  onRemoved?: (ids: string[]) => void;
}) {
  const [chats, setChats] = useState<ChatSession[]>(() => loadChats());
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string>("");
  const [editTitle, setEditTitle] = useState("");
  const [error, setError] = useState("");

  const persist = (next: ChatSession[]) => {
    const previous = loadChats();
    const result = saveChats(next);
    if (!result.ok) { setError("Nie udało się zapisać zmiany. Historia pozostała bez zmian; sprawdź miejsce i dostęp do pamięci urządzenia."); return false; }
    const saved = loadChats();
    const ids = new Set(saved.map((chat) => chat.id));
    onRemoved?.(previous.filter((chat) => !ids.has(chat.id)).map((chat) => chat.id));
    setChats(saved); setError(""); return true;
  };

  const remove = (id: string) => {
    const next = loadChats().filter((c) => c.id !== id);
    persist(next);
  };

  const clearAll = () => {
    if (!window.confirm("Usunąć WSZYSTKIE rozmowy z historii? Tej operacji nie cofniesz.")) return;
    persist([]);
  };

  const saveRename = (id: string) => {
    const title = editTitle.trim();
    const next = loadChats().map((c) => (c.id === id ? { ...c, title: title || c.title } : c));
    if (persist(next)) setEditing("");
  };

  // Filtr (tytuł + treść wiadomości) i pogrupowanie po dacie.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? chats.filter((c) => c.title.toLowerCase().includes(needle) || c.messages.some((m) => m.text?.toLowerCase().includes(needle)))
      : chats;
    const map = new Map<string, ChatSession[]>();
    for (const c of [...filtered].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const b = bucket(c.updatedAt);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(c);
    }
    return ORDER.filter((g) => map.has(g)).map((g) => ({ label: g, items: map.get(g)! }));
  }, [chats, q]);

  return (
    <Modal title="Historia rozmów" onClose={onClose} foot={<>
      {chats.length > 0 && <button className="btn" onClick={clearAll}>Wyczyść historię</button>}
      <button className="btn" onClick={onClose}>Zamknij</button>
    </>}>
          {error && <p className="notice" role="alert">{error}</p>}
          <p className="muted">Usuwanie dotyczy historii rozmów. Zapisane fakty i pozostałą pamięć możesz sprawdzić w panelu Pamięć.</p>
          {chats.length > 0 && (
            <div className="field" style={{ display: "flex", gap: 8 }}>
              <input value={q} aria-label="Szukaj w rozmowach" placeholder="Szukaj w rozmowach…" onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              {q && <button className="chip" aria-label="Wyczyść wyszukiwanie" title="Wyczyść wyszukiwanie" onClick={() => setQ("")}>✕</button>}
            </div>
          )}

          {chats.length === 0 ? (
            <p className="muted">Brak zapisanych rozmów.</p>
          ) : groups.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: "12px 0" }}>Nic nie pasuje do wyszukiwania.</p>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <h3 style={{ fontSize: 13, color: "var(--text-dim)", margin: "10px 0 4px" }}>{g.label} ({g.items.length})</h3>
                {g.items.map((c) => (
                  <div key={c.id} className={`journal-card ${c.id === activeId ? "done" : ""}`} style={{ padding: "8px 10px" }}>
                    {editing === c.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <input value={editTitle} aria-label="Nazwa rozmowy" onChange={(e) => setEditTitle(e.target.value)} autoFocus
                          onKeyDown={(e) => e.key === "Enter" && saveRename(c.id)} style={{ flex: 1, minWidth: 0 }} />
                        <button className="chip" aria-label="Zapisz nazwę" title="Zapisz nazwę" onClick={() => saveRename(c.id)}>✓</button>
                        <button className="chip" aria-label="Anuluj zmianę nazwy" title="Anuluj" onClick={() => setEditing("")}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                        <button type="button" className="chip" style={{ textAlign: "left", flex: 1, minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" }} onClick={() => onOpen(c)}>
                          💬 {c.title}{c.id === activeId ? " · aktywna" : ""}
                        </button>
                        <button type="button" className="chip" aria-label="Zmień nazwę rozmowy" title="Zmień nazwę" onClick={() => { setEditing(c.id); setEditTitle(c.title); }}>✏</button>
                        <button type="button" className="x" aria-label="Usuń rozmowę" title="Usuń rozmowę" style={{ cursor: "pointer" }} onClick={() => remove(c.id)}>✕</button>
                      </div>
                    )}
                    <div className="muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{lastSnippet(c)}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {new Date(c.updatedAt).toLocaleString("pl-PL")} · {c.messages.length} wiad.
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
    </Modal>
  );
}
