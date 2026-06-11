import { useState } from "react";
import { store, uid } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { importDocument } from "../lib/documents";
import { useEscape } from "../hooks/useEscape";

export default function Projects({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const { data, settings } = useStore();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const activeId = settings.activeProjectId;
  const active = data.projects.find((p) => p.id === activeId) || null;
  const files = data.projectFiles.filter((f) => f.projectId === activeId);

  const create = () => {
    const n = name.trim();
    if (!n) return;
    const id = uid();
    store.setData((d) =>
      d.projects.unshift({ id, name: n, instructions: "", createdAt: Date.now(), updatedAt: Date.now() }),
    );
    store.setSettings({ activeProjectId: id });
    setName("");
  };

  const select = (id: string) => store.setSettings({ activeProjectId: id });

  const del = (id: string) => {
    if (!window.confirm("Usun\u0105\u0107 projekt razem z jego dokumentami?")) return;
    store.setData((d) => {
      d.projects = d.projects.filter((p) => p.id !== id);
      d.projectFiles = d.projectFiles.filter((f) => f.projectId !== id);
    });
    if (activeId === id) store.setSettings({ activeProjectId: "" });
  };

  const editInstr = (v: string) =>
    store.setData((d) => {
      const p = d.projects.find((x) => x.id === activeId);
      if (p) { p.instructions = v; p.updatedAt = Date.now(); }
    });

  const attach = async () => {
    setBusy(true);
    try {
      const doc = await importDocument();
      if (doc && activeId) {
        store.setData((d) =>
          d.projectFiles.unshift({
            id: uid(),
            projectId: activeId,
            name: doc.name,
            mime: doc.mime,
            text: doc.text,
            createdAt: Date.now(),
          }),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📁 Projekty / Workspace</h2>
        </div>
        <div className="panel-body">
          <div className={`list-item ${!activeId ? "done" : ""}`}>
            <span style={{ cursor: "pointer", flex: 1 }} onClick={() => select("")}>
              🌐 Ogólny (bez projektu)
            </span>
          </div>
          {data.projects.map((p) => (
            <div key={p.id} className={`list-item ${p.id === activeId ? "done" : ""}`}>
              <span style={{ cursor: "pointer", flex: 1 }} onClick={() => select(p.id)}>
                📂 {p.name}
                {p.id === activeId ? " · aktywny" : ""}
              </span>
              <span className="x" onClick={() => del(p.id)}>
                ✕
              </span>
            </div>
          ))}

          <div className="field" style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              value={name}
              placeholder="Nowy projekt…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <button className="btn" style={{ width: "auto", marginTop: 0 }} onClick={create}>
              Dodaj
            </button>
          </div>

          {active && (
            <>
              <h3>Instrukcje projektu „{active.name}"</h3>
              <textarea
                className="field"
                style={{ width: "100%", minHeight: 80, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, fontFamily: "inherit", fontSize: 15 }}
                placeholder="Np. To projekt 'Praca'. Odpowiadaj formalnie, używaj kontekstu z dokumentów."
                value={active.instructions}
                onChange={(e) => editInstr(e.target.value)}
              />

              <h3>Dokumenty ({files.length})</h3>
              {files.map((f) => (
                <div key={f.id} className="list-item">
                  <span>
                    📄 {f.name} <span className="muted">({Math.round(f.text.length / 1000)}k zn.)</span>
                  </span>
                  <span
                    className="x"
                    onClick={() => store.setData((d) => { d.projectFiles = d.projectFiles.filter((x) => x.id !== f.id); })}
                  >
                    ✕
                  </span>
                </div>
              ))}
              <button className="btn" onClick={attach} disabled={busy}>
                {busy ? "Wczytuję…" : "📎 Dodaj dokument (PDF / tekst)"}
              </button>
            </>
          )}
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
