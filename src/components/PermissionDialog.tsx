import { useState } from "react";
import type { ConsentRequest } from "../lib/permissions";

const LABELS: Record<string, string> = {
  make_call: "Zadzwonić",
  send_sms: "Wysłać SMS",
  call_contact: "Zadzwonić do kontaktu",
  text_contact: "Wysłać SMS do kontaktu",
  smart_home: "Sterować urządzeniem smart home",
  run_scene: "Uruchomić scenę",
  open_service: "Otworzyć aplikację/usługę",
  navigate_to: "Uruchomić nawigację",
  add_task: "Dodać zadanie",
  add_note: "Zapisać notatkę",
  add_reminder: "Ustawić przypomnienie",
  add_shopping_item: "Dodać do listy zakupów",
  add_calendar_event: "Dodać wydarzenie do kalendarza",
  remember_fact: "Zapamiętać informację o Tobie",
  create_scene: "Zapisać scenę",
  complete_task: "Oznaczyć zadanie jako zrobione",
};

export default function PermissionDialog({
  req,
  onDecision,
}: {
  req: ConsentRequest;
  onDecision: (allow: boolean, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const label = LABELS[req.tool] ?? req.tool;
  const summary = JSON.stringify(req.input ?? {}, null, 0).slice(0, 200);

  return (
    <div className="sheet" style={{ zIndex: 60 }}>
      <div className="panel" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🔐 Zgoda na akcję</h2>
        </div>
        <div className="panel-body">
          <p style={{ fontSize: 17, margin: "4px 0 10px" }}>
            JARVIS chce: <b style={{ color: "var(--gold)" }}>{label}</b>
            {req.risk === "outbound" && <span className="muted"> · akcja zewnętrzna</span>}
          </p>
          {summary !== "{}" && (
            <pre
              style={{
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 10,
                fontSize: 12,
                color: "var(--text-dim)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {summary}
            </pre>
          )}
          <label className="row" style={{ cursor: "pointer" }}>
            <span>Zapamiętaj zgodę dla tej akcji</span>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ width: 20, height: 20 }}
            />
          </label>
        </div>
        <div className="panel-foot" style={{ display: "flex", gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => onDecision(false, false)}>
            Odmów
          </button>
          <button className="btn primary" style={{ flex: 1 }} onClick={() => onDecision(true, remember)}>
            Zezwól
          </button>
        </div>
      </div>
    </div>
  );
}
