import { useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import Modal from "./Modal";
import { toast } from "../lib/toast";
import { filterAudit, auditStats, inputPreview, type AuditStatus } from "../lib/auditView";

// Dziennik — co realnie przeszło przez program: akcje/narzędzia, kiedy, z jakim skutkiem.
// W 100% lokalnie (dane nie opuszczają urządzenia). Filtr, szukanie, eksport i czyszczenie.
const ICON: Record<string, string> = { ok: "✅", error: "⚠", denied: "🚫" };

export default function AuditLog({ onClose }: { onClose: () => void }) {
  useStore();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AuditStatus>("all");

  const all = store.data.audit || [];
  const stats = auditStats(all);
  const shown = filterAudit(all, { q, status });

  const exportJson = async () => {
    try { await navigator.clipboard?.writeText(JSON.stringify(all, null, 2)); toast("📋 Dziennik skopiowany (JSON)"); }
    catch { toast("Brak dostępu do schowka"); }
  };
  const clearAll = () => {
    if (!window.confirm("Wyczyścić cały dziennik na tym urządzeniu? Tej operacji nie cofniesz.")) return;
    store.setData((d) => { d.audit = []; });
    toast("🗑 Dziennik wyczyszczony");
  };

  const TABS: { id: AuditStatus; label: string }[] = [
    { id: "all", label: `Wszystko (${stats.total})` },
    { id: "ok", label: `✅ ${stats.ok}` },
    { id: "error", label: `⚠ ${stats.error}` },
    { id: "denied", label: `🚫 ${stats.denied}` },
  ];

  return (
    <Modal
      title="📜 Dziennik działań"
      onClose={onClose}
      footStyle={{ display: "flex", gap: 8 }}
      foot={
        <>
          {all.length > 0 && <button className="btn" onClick={exportJson}>📋 Eksport</button>}
          {all.length > 0 && <button className="btn" onClick={clearAll}>🗑 Wyczyść</button>}
          <button className="btn primary" style={{ flex: 1 }} onClick={onClose}>Zamknij</button>
        </>
      }
    >
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Co przeszło przez JARVIS-a (ostatnie {all.length}). Tylko lokalnie — nic nie wychodzi z urządzenia.
          </p>

          <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
            {TABS.map((t) => (
              <button key={t.id} className={`chip ${status === t.id ? "on" : ""}`} onClick={() => setStatus(t.id)}>{t.label}</button>
            ))}
          </div>

          {all.length > 6 && (
            <input className="ta" style={{ minHeight: 0, padding: "8px 10px", marginBottom: 8 }} placeholder="🔎 szukaj (narzędzie, treść, wynik)…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}

          {shown.length === 0 && <p className="muted">{all.length ? "Nic nie pasuje." : "Dziennik jest pusty — pojawią się tu akcje wykonane przez JARVIS-a."}</p>}

          {shown.map((e) => (
            <div className="status-row" key={e.id}>
              <div className="status-main">
                <div className="status-title">{ICON[e.status] || "•"} {e.tool}</div>
                {e.input != null && inputPreview(e.input) && <div className="status-detail">{inputPreview(e.input)}</div>}
                {e.output && <div className="muted" style={{ fontSize: 12 }}>{inputPreview(e.output, 120)}</div>}
              </div>
              <div className="muted" style={{ fontSize: 11, flex: "0 0 auto", textAlign: "right" }}>
                {new Date(e.at).toLocaleString("pl-PL")}
              </div>
            </div>
          ))}
    </Modal>
  );
}
