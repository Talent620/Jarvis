import { useEffect, useState } from "react";
import { runHealthCheck, type HealthItem } from "../lib/healthCheck";
import { useEscape } from "../hooks/useEscape";
import { toast } from "../lib/toast";

// Ekran „Stan systemu": przy każdej funkcji widać wprost — 🟢 działa, 🟡 do
// skonfigurowania / nieaktywne tu, 🔴 nie działa. Gdy JARVIS umie naprawić sam,
// pokazuje przycisk „Napraw". Reużywa runHealthCheck (ta sama logika co w ⚙).
export default function SystemStatus({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [items, setItems] = useState<HealthItem[]>([]);
  const [busy, setBusy] = useState(true);

  const scan = async () => {
    setBusy(true);
    await runHealthCheck(setItems, true);
    setBusy(false);
  };

  useEffect(() => { void scan(); }, []);

  const counts = {
    ok: items.filter((i) => i.status === "ok").length,
    warn: items.filter((i) => i.status === "warn" || i.status === "info").length,
    err: items.filter((i) => i.status === "err").length,
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🩺 Stan systemu</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            🟢 {counts.ok} działa · 🟡 {counts.warn} do ustawienia · 🔴 {counts.err} nie działa
            {busy ? " · sprawdzam…" : ""}
          </p>

          {items.map((it) => (
            <div className="status-row" key={it.id}>
              <span className={`status-dot ${it.status}`} />
              <div className="status-main">
                <div className="status-title">{it.icon} {it.title}</div>
                <div className="status-detail">{it.detail}</div>
                {it.fix && (
                  <button
                    className="btn"
                    style={{ marginTop: 8, padding: "6px 12px", fontSize: 13 }}
                    onClick={() => { it.fix!.apply(); toast(`✅ ${it.fix!.label}`); void scan(); }}
                  >
                    🔧 {it.fix.label}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="panel-foot" style={{ display: "flex", gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={scan} disabled={busy}>{busy ? "Sprawdzam…" : "🔄 Sprawdź ponownie"}</button>
          <button className="btn primary" style={{ flex: 1 }} onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
