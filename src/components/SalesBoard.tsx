import { useMemo, useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import type { GrowthContext } from "../lib/growthContext";
import { boardColumns, stageMoveNote } from "../lib/salesBoard";
import { nextActionFor } from "../lib/clientCrm";
import { relationshipStatus } from "../lib/salesEngine";
import { appendLeadNote } from "../lib/leadNotes";
import { formatZl } from "../lib/salesCockpit";
import { toast } from "../lib/toast";
import type { LeadStatus } from "../types";
import ClientPanel from "./ClientPanel";
import LeadDetail from "./LeadDetail";

// 📋 Tablica lejka (kanban) — karty leadów w kolumnach etapów, suma wartości pod każdą.
// Przeciągnięcie karty na inną kolumnę = zmiana etapu (+ ślad w osi). Tap karty = Panel Klienta.
// Cała matematyka w salesBoard (pure). Na telefonie DnD bywa kapryśne — tap+etapy w Panelu zawsze działają.
export default function SalesBoard({ onWeb, onMoney }: {
  onWeb?: (ctx?: GrowthContext) => void;
  onMoney?: () => void;
}) {
  const { data } = useStore();
  const leads = useMemo(() => data.leads || [], [data.leads]);
  const columns = useMemo(() => boardColumns(leads), [leads]);
  const [openClient, setOpenClient] = useState<string | null>(null);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<LeadStatus | null>(null);

  const moveTo = (leadId: string, toStatus: LeadStatus) => {
    const lead = store.data.leads.find((l) => l.id === leadId);
    if (!lead || lead.status === toStatus) return;
    const toLabel = columns.find((c) => c.stage.id === toStatus)?.stage.label || toStatus;
    store.setData((d) => {
      const l = d.leads.find((x) => x.id === leadId);
      if (l) { l.status = toStatus; l.notes = appendLeadNote(l.notes, stageMoveNote(toLabel), Date.now()); l.updatedAt = Date.now(); }
    });
    toast(`➡ „${lead.company}" → ${toLabel}`);
  };

  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });

  return (
    <div className="panel-body" style={{ overflow: "hidden" }}>
      {leads.length === 0 ? (
        <p className="muted" style={{ padding: "12px 4px", fontSize: 13 }}>Brak leadów. Znajdź firmy w „🧲 Nowe znalezione" albo powiedz „znajdź leady stolarz Poznań".</p>
      ) : (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, alignItems: "flex-start" }}>
          {columns.map((col) => (
            <div
              key={col.stage.id}
              data-testid={`col-${col.stage.id}`}
              onDragOver={(e) => { e.preventDefault(); setOverStage(col.stage.id); }}
              onDragLeave={() => setOverStage((s) => (s === col.stage.id ? null : s))}
              onDrop={(e) => { e.preventDefault(); if (dragId) moveTo(dragId, col.stage.id); setDragId(null); setOverStage(null); }}
              style={{
                flex: "0 0 220px", minWidth: 200, maxHeight: "70vh", display: "flex", flexDirection: "column",
                background: overStage === col.stage.id ? "rgba(108,231,255,.08)" : "var(--bg-2, rgba(128,128,128,.05))",
                border: `1px solid ${overStage === col.stage.id ? "var(--cyan)" : "var(--line, rgba(128,128,128,.2))"}`,
                borderRadius: 10, padding: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{col.stage.label}</span>
                <span className="muted" style={{ fontSize: 11 }}>{col.leads.length} · {formatZl(col.total)}</span>
              </div>
              <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {col.leads.map((l) => {
                  const overdue = relationshipStatus(l).overdue;
                  return (
                    <div
                      key={l.id}
                      data-testid={`card-${l.id}`}
                      draggable
                      onDragStart={() => setDragId(l.id)}
                      onDragEnd={() => { setDragId(null); setOverStage(null); }}
                      onClick={() => setOpenClient(l.id)}
                      className="journal-card"
                      style={{ margin: 0, padding: "8px 10px", cursor: "grab", borderLeft: overdue ? "3px solid var(--gold)" : undefined }}
                      title="Przeciągnij, by zmienić etap · kliknij, by otworzyć"
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.company}</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {l.value ? <span>💵 {formatZl(l.value)}</span> : null}
                        {overdue && <span style={{ color: "var(--gold)" }}>⚠ zaległy</span>}
                        {l.nextFollowUpAt && !overdue ? <span>🔁 {fmtDate(l.nextFollowUpAt)}</span> : null}
                      </div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.3 }}>{nextActionFor(l)}</div>
                    </div>
                  );
                })}
                {col.leads.length === 0 && <div className="muted" style={{ fontSize: 11, textAlign: "center", padding: "8px 0", opacity: 0.6 }}>— pusto —</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {openClient && <ClientPanel leadId={openClient} onClose={() => setOpenClient(null)} onDossier={(id) => setOpenLead(id)} onMoney={onMoney} />}
      {openLead && <LeadDetail leadId={openLead} onClose={() => setOpenLead(null)} onWeb={onWeb} />}
    </div>
  );
}
