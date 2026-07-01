// === Jeden Marketing (MarketingWorkspace) ===
// Zamiast trzech osobnych okien (Treści/Reklamy/Marka) — JEDEN ekran z zakładkami: Treści | Kampanie |
// Marka | Wyniki. Reużywa istniejące komponenty w trybie embedded (bez duplikacji). Zakładka „Wyniki"
// łączy przychód/koszt kampanii z istniejącą pętlą ROI. Status każdej kampanii jest jednoznaczny,
// a SIMULATED nigdy nie jest PUBLISHED. Stare wejścia (content/ads/brand) otwierają właściwą zakładkę.

import { useMemo, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { useStore } from "../hooks/useStore";
import { toast } from "../lib/toast";
import { MARKETING_TABS, campaignStatusLabel, campaignMainAction, type MarketingTab } from "../lib/marketingModel";
import { setCampaignStatus } from "../lib/campaignStore";
import { computeRoi } from "../lib/campaignRoi";
import ContentStudio from "./ContentStudio";
import AdStudio from "./AdStudio";
import BrandKit from "./BrandKit";

export default function MarketingWorkspace({ onClose, initialTab = "content" }: { onClose: () => void; initialTab?: MarketingTab }) {
  useEscape(onClose);
  const { data } = useStore();
  const [tab, setTab] = useState<MarketingTab>(initialTab);
  const campaigns = useMemo(() => data.campaigns || [], [data.campaigns]);
  const roi = useMemo(() => computeRoi(data.campaigns || [], data.leads || [], Date.now()), [data.campaigns, data.leads]);

  const advance = (id: string) => {
    const c = campaigns.find((x) => x.id === id);
    if (!c) return;
    const a = campaignMainAction(c);
    if (!a.to) return;
    setCampaignStatus(id, a.to, Date.now(), "marketing workspace");
    // Publikacja to osobny, potwierdzony skutek — samo „oznacz potwierdzone" nie udaje realnej publikacji.
    toast(a.to === "published_confirmed" ? "Oznaczono jako potwierdzone (po realnej publikacji)." : `Status: ${campaignStatusLabel(a.to)}`);
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📣 Marketing</h2>
          <div className="chips" style={{ flexWrap: "wrap", marginTop: 6, padding: "0 4px" }}>
            {MARKETING_TABS.map((t) => (
              <button key={t.id} type="button" className={`chip ${tab === t.id ? "on" : ""}`} aria-pressed={tab === t.id} onClick={() => setTab(t.id)} style={{ fontSize: 12 }}>
                {t.label}{t.id === "campaigns" && campaigns.length ? ` (${campaigns.length})` : ""}
              </button>
            ))}
          </div>
        </div>
        {tab === "content" && <ContentStudio embedded onClose={onClose} />}
        {tab === "brand" && <BrandKit embedded onClose={onClose} />}
        {tab === "campaigns" && <AdStudio embedded onClose={onClose} />}
        {tab === "results" && (
          <div className="panel-body">
            {/* 💸 Wyniki — ROI z realnego store: przychód wygranych leadów przypięty do kampanii. */}
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Przypisany przychód: <b style={{ color: "var(--ok, #58e08a)" }}>{roi.attribution.total} zł</b>
              {roi.attribution.unattributed > 0 && <> · nieprzypisane: {roi.attribution.unattributed} zł</>}
            </div>
            {campaigns.length === 0 ? (
              <p className="muted" style={{ textAlign: "center", padding: "16px 0" }}>Brak kampanii. Utwórz je w zakładce „Kampanie”.</p>
            ) : campaigns.map((c) => {
              const rev = roi.attribution.byCampaign[c.id] || 0;
              const a = campaignMainAction(c);
              return (
                <div key={c.id} className="journal-card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <b style={{ minWidth: 0 }}>{c.offer || c.id}</b>
                    <span className="chip" style={{ fontSize: 11 }}>{campaignStatusLabel(c.status)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {c.type === "paid_ad" ? "Reklama płatna" : "Post organiczny"} · przychód: {rev} zł{c.budget?.amount ? ` · budżet: ${c.budget.amount} zł` : ""}
                  </div>
                  {a.to && (
                    <button type="button" className="chip" style={{ marginTop: 8, borderColor: "var(--cyan, #6ce7ff)" }} onClick={() => advance(c.id)}>{a.label}</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
