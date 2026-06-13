import { useMemo, useState } from "react";
import { useStore } from "../hooks/useStore";
import { callNowList, followUpsDue, followUpMessage, markContacted, pipelineForecast, openLabel } from "../lib/salesEngine";
import { smsUrl, gmailComposeUrl } from "../lib/glinks";
import { scoreLabel } from "../lib/leadIntel";
import { copyWithToast } from "../lib/toast";
import { useEscape } from "../hooks/useEscape";
import type { Lead } from "../types";

/**
 * Plan Sprzedaży na Dziś — konkretna lista DZIAŁAŃ, które przynoszą pieniądze:
 *  • do kogo dzwonić TERAZ (otwarte + gorące + niezaczepione),
 *  • komu wysłać follow-up (gotowe treści, bo to ponaglenia domykają sprzedaż),
 *  • ile realnie wisi w lejku.
 */
export default function SalesPlan({ onClose, onLead }: { onClose: () => void; onLead?: (id: string) => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const leads = data.leads || [];
  const now = new Date();
  const [, force] = useState(0);

  const callNow = useMemo(() => callNowList(leads, now).slice(0, 12), [leads]);
  const followUps = useMemo(() => followUpsDue(leads).slice(0, 12), [leads]);
  const fc = useMemo(() => pipelineForecast(leads), [leads]);

  const email = (l: Lead) => l.email || (l.contact?.includes("@") ? l.contact : "");
  const phone = (l: Lead) => (l.contact && !l.contact.includes("@") ? l.contact : "");

  const call = (l: Lead) => {
    window.open(`tel:${phone(l).replace(/\s/g, "")}`);
    markContacted(l.id);
    force((x) => x + 1);
  };

  const sendFollowUp = (l: Lead, kind: "sms" | "gmail" | "done") => {
    const msg = followUpMessage(l, (l.followUpCount ?? 0) + 1);
    if (kind === "sms" && phone(l)) window.open(smsUrl(phone(l), msg), "_blank");
    else if (kind === "gmail" && email(l)) window.open(gmailComposeUrl(email(l), `W sprawie strony dla ${l.company}`, msg), "_blank", "noopener");
    markContacted(l.id, true);
    force((x) => x + 1);
  };

  const copyFollowUp = (l: Lead) => copyWithToast(followUpMessage(l, (l.followUpCount ?? 0) + 1), "Treść skopiowana ✓");

  const dateLabel = now.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🎯 Plan sprzedaży na dziś</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, textTransform: "capitalize" }}>{dateLabel}</p>

          {/* Prognoza lejka */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 19, fontFamily: "Orbitron", color: "var(--gold)" }}>{fc.expected} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>prognoza (ważona)</div>
            </div>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 19, fontFamily: "Orbitron", color: "var(--cyan)" }}>{fc.pipeline} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>w lejku</div>
            </div>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 19, fontFamily: "Orbitron", color: "var(--ok, #58e08a)" }}>{fc.won} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>zarobione</div>
            </div>
          </div>

          {/* Dzwoń TERAZ */}
          <h3>📞 Dzwoń teraz ({callNow.length})</h3>
          {callNow.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Brak firm do dzwonienia w tej chwili (wszystkie zaczepione albo zamknięte). Znajdź nowe leady albo wróć w godzinach pracy firm.
            </p>
          ) : (
            callNow.map((l) => {
              const ol = openLabel(l.hours, now);
              const sc = l.intel ? scoreLabel(l.intel.score) : null;
              return (
                <div key={l.id} className="journal-card" style={{ padding: "8px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <b style={{ cursor: onLead ? "pointer" : "default" }} onClick={() => onLead?.(l.id)}>
                      {sc ? `${sc.emoji} ` : ""}{l.company}
                    </b>
                    <span style={{ fontSize: 11, color: ol.open ? "var(--ok, #58e08a)" : "var(--text-dim)" }}>{ol.open ? "🟢" : "⚪"} {ol.text}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{[phone(l), l.location].filter(Boolean).join(" · ")}{l.intel ? ` · szansa ${l.intel.score}/100` : ""}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <button className="chip" style={{ borderColor: "var(--ok, #58e08a)" }} onClick={() => call(l)}>📞 Zadzwoń</button>
                    {onLead && <button className="chip" onClick={() => onLead(l.id)}>🗂 Teczka</button>}
                  </div>
                </div>
              );
            })
          )}

          {/* Follow-upy */}
          <h3 style={{ marginTop: 14 }}>🔁 Follow-up dzisiaj ({followUps.length})</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
            Większość sprzedaży dzieje się po 2.–5. kontakcie. Te firmy zaczepiłeś, nie odpowiedziały — czas na delikatne ponaglenie.
          </p>
          {followUps.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Brak ponagleń na dziś. Świetna robota — wszyscy obsłużeni na czas.</p>
          ) : (
            followUps.map((l) => (
              <div key={l.id} className="journal-card" style={{ padding: "8px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <b style={{ cursor: onLead ? "pointer" : "default" }} onClick={() => onLead?.(l.id)}>{l.company}</b>
                  <span className="muted" style={{ fontSize: 11 }}>ponaglenie #{(l.followUpCount ?? 0) + 1}</span>
                </div>
                <p className="muted" style={{ fontSize: 12, whiteSpace: "pre-wrap", margin: "4px 0 0", maxHeight: 64, overflow: "hidden" }}>
                  {followUpMessage(l, (l.followUpCount ?? 0) + 1)}
                </p>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {phone(l) && <button className="chip" onClick={() => sendFollowUp(l, "sms")}>📱 SMS</button>}
                  {email(l) && <button className="chip" onClick={() => sendFollowUp(l, "gmail")}>✉ Gmail</button>}
                  <button className="chip" onClick={() => copyFollowUp(l)}>📋 Kopiuj</button>
                  <button className="chip" onClick={() => sendFollowUp(l, "done")}>✅ Wysłane</button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
