import { useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { rememberFact, deleteFact, setFactPinned, editFact } from "../lib/memory";
import Modal from "./Modal";
import { toast } from "../lib/toast";

// Centrum Pamięci — „co JARVIS o mnie wie", z pełną kontrolą: przeglądaj, edytuj,
// przypinaj i usuwaj fakty. Top-asystenty dają użytkownikowi władzę nad pamięcią.
export default function MemoryCenter({ onClose }: { onClose: () => void }) {
  useStore(); // odśwież po zmianach w store
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  const facts = [...(store.data.memory || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
  const ql = q.trim().toLowerCase();
  const shown = ql ? facts.filter((f) => `${f.key} ${f.value}`.toLowerCase().includes(ql)) : facts;

  const saveEdit = (id: string) => { editFact(id, draft.trim()); setEditing(null); };
  const add = () => {
    if (!newKey.trim() || !newVal.trim()) return;
    rememberFact(newKey.trim(), newVal.trim());
    setNewKey(""); setNewVal(""); toast("✅ Zapamiętane");
  };

  return (
    <Modal
      title="🧠 Co JARVIS o mnie wie"
      onClose={onClose}
      foot={<button className="btn primary" onClick={onClose}>Zamknij</button>}
    >
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Pełna kontrola nad pamięcią. {facts.length} {facts.length === 1 ? "fakt" : "faktów"}. Przypięte (📌) nigdy nie znikają.
          </p>

          {/* Dodaj fakt ręcznie */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input className="ta" style={{ flex: "0 0 38%", minHeight: 0, padding: "8px 10px" }} placeholder="klucz (np. imię_żony)" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
            <input className="ta" style={{ flex: 1, minHeight: 0, padding: "8px 10px" }} placeholder="wartość" value={newVal} onChange={(e) => setNewVal(e.target.value)} />
            <button className="btn primary" style={{ width: "auto" }} onClick={add}>＋</button>
          </div>

          {facts.length > 6 && (
            <input className="ta" style={{ minHeight: 0, padding: "8px 10px", marginBottom: 8 }} placeholder="🔎 szukaj w pamięci…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}

          {shown.length === 0 && <p className="muted">{facts.length ? "Brak wyników." : "JARVIS jeszcze nic o Tobie nie zapamiętał. Powiedz „zapamiętaj, że…” albo dodaj fakt powyżej."}</p>}

          {shown.map((f) => (
            <div className="status-row" key={f.id}>
              <div className="status-main">
                <div className="status-title">{f.pinned ? "📌 " : ""}{f.key}</div>
                {editing === f.id ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <input className="ta" style={{ flex: 1, minHeight: 0, padding: "8px 10px" }} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                    <button className="btn primary" style={{ width: "auto" }} onClick={() => saveEdit(f.id)}>Zapisz</button>
                  </div>
                ) : (
                  <div className="status-detail">{f.value}</div>
                )}
              </div>
              {editing !== f.id && (
                <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
                  <button className="icon-btn" title={f.pinned ? "Odepnij" : "Przypnij"} onClick={() => setFactPinned(f.id, !f.pinned)}>{f.pinned ? "📌" : "📍"}</button>
                  <button className="icon-btn" title="Edytuj" onClick={() => { setEditing(f.id); setDraft(f.value); }}>✏</button>
                  <button className="icon-btn" title="Usuń" onClick={() => { deleteFact(f.id); toast("🗑 Usunięto z pamięci"); }}>🗑</button>
                </div>
              )}
            </div>
          ))}
    </Modal>
  );
}
