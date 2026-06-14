import { useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { useEscape } from "../hooks/useEscape";

// 📤 Skrzynka wysłanych — lista maili wysłanych wprost z aplikacji (komu, co, kiedy,
// jakim kanałem). Zapis lokalny; potwierdza „że się udało" i gdzie poszło.
export default function SentBox({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  useStore();
  const [q, setQ] = useState("");

  const all = store.data.sentMail || [];
  const ql = q.trim().toLowerCase();
  const shown = ql
    ? all.filter((m) => `${m.to} ${m.subject} ${m.company || ""}`.toLowerCase().includes(ql))
    : all;

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📤 Skrzynka wysłanych</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Maile wysłane wprost z aplikacji ({all.length}). Potwierdzenie, że poszły — i do kogo.
          </p>

          {all.length > 6 && (
            <input
              className="ta"
              style={{ minHeight: 0, padding: "8px 10px", marginBottom: 8 }}
              placeholder="🔎 szukaj (adresat, firma, temat)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}

          {shown.length === 0 && (
            <p className="muted">
              {all.length ? "Nic nie pasuje." : "Pusto — wysłane maile (przyciskiem Napisz i wyślij lub WYŚLIJ TERAZ) pojawią się tutaj."}
            </p>
          )}

          {shown.map((m) => (
            <div className="status-row" key={m.id}>
              <div className="status-main">
                <div className="status-title">✅ {m.company || m.to}</div>
                <div className="status-detail">{m.subject}</div>
                <div className="muted" style={{ fontSize: 12 }}>{m.to} · {m.via}</div>
              </div>
              <div className="muted" style={{ fontSize: 11, flex: "0 0 auto", textAlign: "right" }}>
                {new Date(m.at).toLocaleString("pl-PL")}
              </div>
            </div>
          ))}
        </div>
        <div className="panel-foot">
          <button className="btn primary" style={{ width: "100%" }} onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
