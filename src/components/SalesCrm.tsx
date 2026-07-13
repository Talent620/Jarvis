// === Jeden ekran „Sprzedaż / CRM" (SalesCrm) ===
// Domyka rozjazd UX: zamiast dwóch osobnych okien (Kandydaci + Pulpit) masz JEDEN ekran z zakładkami.
// „Nowe znalezione" (wyszukiwanie kandydatów), „Do działania" (domyślna — bez odrzuconych), „Klienci"
// i „Archiwum" (odrzuceni). Import przenosi firmę do „Do działania" i od razu tam przełącza — nie musisz
// zgadywać, gdzie trafiła. Stare wejścia (Kandydaci / Pulpit) otwierają ten ekran na właściwej zakładce.
// Addytywnie: reużywa istniejących komponentów w trybie embedded (bez duplikacji logiki).

import { useMemo, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { useStore } from "../hooks/useStore";
import type { GrowthContext } from "../lib/growthContext";
import { bucketCounts, type CrmBucket } from "../lib/crmBuckets";
import LeadCandidatesPanel from "./LeadCandidatesPanel";
import SalesDashboard from "./SalesDashboard";

export type CrmTab = "found" | CrmBucket;

const TABS: { id: CrmTab; label: string }[] = [
  { id: "found", label: "🧲 Nowe znalezione" },
  { id: "actionable", label: "🎯 Do działania" },
  { id: "clients", label: "✅ Klienci" },
  { id: "archive", label: "🗄 Archiwum" },
];

export default function SalesCrm({ onClose, onWeb, onMoney, onConnections, initialTab = "actionable" }: {
  onClose: () => void;
  onWeb?: (ctx?: GrowthContext) => void;
  onMoney?: () => void;
  onConnections?: () => void;
  initialTab?: CrmTab;
}) {
  useEscape(onClose);
  const { data } = useStore();
  const [tab, setTab] = useState<CrmTab>(initialTab);
  const counts = useMemo(() => bucketCounts(data.leads || []), [data.leads]);
  const countFor = (t: CrmTab): number | null => (t === "found" ? null : counts[t]);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📈 Sprzedaż / CRM</h2>
          {/* Zakładki — jedno miejsce nawigacji, licznik pokazuje ile firm w każdym kubełku. */}
          <div className="chips" style={{ flexWrap: "wrap", marginTop: 6, padding: "0 4px" }}>
            {TABS.map((t) => {
              const n = countFor(t.id);
              return (
                <button key={t.id} className={`chip ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} style={{ fontSize: 12 }}>
                  {t.label}{n != null ? ` (${n})` : ""}
                </button>
              );
            })}
          </div>
        </div>
        {tab === "found" ? (
          // „Nowe znalezione" — wyszukiwanie kandydatów. Po imporcie przeskocz do „Do działania".
          <LeadCandidatesPanel embedded onClose={onClose} onWeb={onWeb ? (ctx) => onWeb(ctx) : undefined} onImported={() => setTab("actionable")} />
        ) : (
          // CRM: leady danego kubełka (Do działania / Klienci / Archiwum).
          <SalesDashboard embedded bucket={tab} onClose={onClose} onWeb={onWeb} onMoney={onMoney} onConnections={onConnections} />
        )}
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
