import { useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { usePersistentState } from "../hooks/usePersistentState";
import { copyWithToast, toast, shareOrCopy } from "../lib/toast";
import { generateAds, AD_PLATFORMS, AD_GOALS, type AdPlatform, type AdGoal } from "../lib/adStudio";
import { AD_ANGLES, adAngleGuide } from "../lib/adAngles";
import { scoreAdCopy, adQualityLabel } from "../lib/adQuality";
import { buildUtmUrl, UTM_PRESETS, type UtmPreset } from "../lib/utm";
import { buildAdCampaign } from "../lib/adCampaign";
import { saveCampaign } from "../lib/campaignStore";
import { canExport, type CampaignPlan } from "../lib/campaignEngine";
import { resolveChannelCapability } from "../lib/platformCapabilities";
import { uid } from "../lib/store";

// Etykiety stanu kanału (capability) → uczciwy przycisk: connected/export_only/simulated/unavailable.
const CHANNEL_STATE_LABEL: Record<string, string> = {
  connected: "🟢 Połączono (API)",
  export_only: "📤 Tylko eksport (brak API)",
  simulated: "🧪 Symulacja",
  degraded: "🟡 API z problemami",
  unavailable: "⚪ Niedostępne",
};

// 📢 Generator reklam (Faza 0) — gotowe zestawy reklam Google/Meta do skopiowania.
export default function AdStudio({ onClose, embedded }: { onClose: () => void; embedded?: boolean }) {
  useEscape(onClose);
  // Trwała sesja funkcji: parametry i wygenerowany wynik nie giną po wyjściu z panelu/apki.
  const [platform, setPlatform] = usePersistentState<AdPlatform>("ads.platform", "google");
  const [product, setProduct] = usePersistentState("ads.product", "");
  const [audience, setAudience] = usePersistentState("ads.audience", "");
  const [goal, setGoal] = usePersistentState<AdGoal>("ads.goal", "leady/kontakty");
  const [budget, setBudget] = usePersistentState("ads.budget", "");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = usePersistentState("ads.out", "");
  const [campaign, setCampaign] = usePersistentState<CampaignPlan | null>("ads.campaign", null); // strukturalny plan (nie luźny tekst)
  const [angle, setAngle] = usePersistentState("ads.angle", ""); // kąt emocjonalny (Ad Creative Engine)
  // 🔗 Builder linków UTM (mierzenie ROI reklam/social).
  const [utmUrl, setUtmUrl] = usePersistentState("ads.utmUrl", "");
  const [utmPreset, setUtmPreset] = usePersistentState<UtmPreset | null>("ads.utmPreset", null);
  const [utmCampaign, setUtmCampaign] = usePersistentState("ads.utmCampaign", "");
  const utmLink = utmPreset ? buildUtmUrl({ url: utmUrl, source: utmPreset.source, medium: utmPreset.medium, campaign: utmCampaign }) : "";

  const generate = async () => {
    if (!product.trim()) { toast("Wpisz produkt/usługę."); return; }
    setBusy(true);
    setOut("");
    const r = await generateAds({ platform, product, audience: audience || undefined, goal, budget: budget || undefined, angle: adAngleGuide(angle) || undefined });
    setBusy(false);
    if (!r) { toast("Nie udało się wygenerować — sprawdź klucz AI (⚙ → Mózg)."); return; }
    setOut(r);
    // Reklama płatna = PRAWDZIWA kampania (paid_ad), nie „post w historii". Zapisujemy szkic (draft)
    // z parsowaną kreacją i wspólnym ID (campaignId ↔ utm.campaign) do pętli ROI.
    const plan = buildAdCampaign({ id: uid(), uiPlatform: platform, product: product.trim(), audience: audience || undefined, goal, rawText: r, now: Date.now() });
    saveCampaign(plan);
    setCampaign(plan);
    setUtmCampaign(plan.utm.campaign); // link UTM dzieli campaignId z kampanią
    toast("📁 Zapisano kampanię (szkic) — znajdziesz ją w pętli ROI.");
  };

  // Zdolność kanału: klient nie trzyma tokenów reklamowych (sekrety po stronie backendu) → uczciwie
  // export-only. Nie udajemy „opublikowano". Reklama płatna wymaga Ads API — zwykły post jej nie zastąpi.
  const capability = resolveChannelCapability({ channel: platform === "google" ? "Google Ads" : "Meta Ads", hasToken: false, supportsExport: true, supportsPaidAds: true });

  const canShare = typeof navigator !== "undefined" && !!(navigator as { share?: unknown }).share;
  const share = () => shareOrCopy(out, "Skopiowano — wklej w panelu reklam ✓");

  const body = (
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Podaj produkt — JARVIS napisze gotowy zestaw reklam (nagłówki, opisy, słowa kluczowe, budżet). Kopiujesz i wklejasz w panelu Google/Meta.
          </p>

          <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
            {AD_PLATFORMS.map((p) => (
              <button key={p.id} className={`chip ${platform === p.id ? "on" : ""}`} onClick={() => setPlatform(p.id)}>
                {p.emoji} {p.label}
              </button>
            ))}
          </div>

          <div className="field">
            <textarea
              className="ta"
              rows={2}
              value={product}
              placeholder="Produkt/usługa, np. „strony internetowe dla lokalnych firm” albo „świeże szparagi z dostawą”"
              onChange={(e) => setProduct(e.target.value)}
            />
          </div>
          <div className="field">
            <input value={audience} placeholder="Grupa docelowa (opcjonalnie), np. „firmy z Poznania bez strony”" onChange={(e) => setAudience(e.target.value)} />
          </div>
          <div className="field" style={{ display: "flex", gap: 8 }}>
            <select value={goal} onChange={(e) => setGoal(e.target.value as AdGoal)} style={{ flex: 1 }}>
              {AD_GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <input value={budget} placeholder="Budżet (opcj.) np. 30 zł/dzień" onChange={(e) => setBudget(e.target.value)} style={{ flex: 1 }} />
          </div>

          {/* 🎯 Kąt emocjonalny (Ad Creative Engine) — opcjonalny hook przekazu */}
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>🎯 Kąt przekazu (opcjonalnie)</div>
          <div className="chips" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {AD_ANGLES.map((a) => (
              <button key={a.id} className={`chip ${angle === a.id ? "on" : ""}`} title={a.guide} onClick={() => setAngle(angle === a.id ? "" : a.id)} disabled={busy}>{a.label}</button>
            ))}
          </div>

          <button className="btn primary" style={{ width: "100%" }} onClick={generate} disabled={busy}>
            {busy ? "✍ Tworzę reklamy…" : "✨ Wygeneruj reklamy"}
          </button>
          {/* 🆕 Czysta karta: sesja jest trwała (produkt/wynik/kampania/UTM wracają zawsze) —
              jawny reset pod nową kampanię. Platforma zostaje (preferencja), cel wraca do domyślnego. */}
          {(product || out || campaign || utmUrl) && (
            <button
              className="btn"
              style={{ width: "100%", marginTop: 8 }}
              data-testid="ads-fresh"
              disabled={busy}
              onClick={() => {
                setProduct(""); setAudience(""); setGoal("leady/kontakty"); setBudget("");
                setOut(""); setCampaign(null); setAngle("");
                setUtmUrl(""); setUtmPreset(null); setUtmCampaign("");
                toast("🆕 Czysta karta — opisz nowy produkt/usługę.");
              }}
            >
              🆕 Nowa kampania (wyczyść)
            </button>
          )}

          {out && (() => {
            // 📋 Audyt jakości/zgodności reklamy — ryzyko odrzucenia przez Google/Meta (czysto, lokalnie).
            const q = scoreAdCopy(platform, out);
            const color = q.risk === "low" ? "#39d98a" : q.risk === "medium" ? "var(--gold)" : "#ff6b6b";
            return (
              <div style={{ marginTop: 10, fontSize: 12.5 }}>
                <span style={{ fontWeight: 700, color }}>📋 {adQualityLabel(q)}</span>
                {q.issues.length > 0 && <div className="muted" style={{ marginTop: 3 }}>Popraw: {q.issues.slice(0, 3).join(" ")}</div>}
                {q.issues.length === 0 && q.wins.length > 0 && <div className="muted" style={{ marginTop: 3 }}>✓ {q.wins.join(" ")}</div>}
              </div>
            );
          })()}

          {campaign && (() => {
            // Format walidowany PRZED eksportem (np. za długi nagłówek RSA) — bez fałszywego „gotowe".
            const fmt = canExport(campaign);
            return (
              <div className="journal-card" style={{ marginTop: 10, borderColor: fmt.ok ? "var(--ok, #58e08a)" : "#ff6b6b" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  📁 Kampania: {campaign.creative.headlines.length} nagłówków · {campaign.creative.descriptions.length} opisów
                  <span className="chip" style={{ marginLeft: 6, fontSize: 11 }}>szkic</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {CHANNEL_STATE_LABEL[capability.state] || capability.state} — {capability.reason}
                </div>
                {fmt.ok
                  ? <div style={{ fontSize: 12, color: "var(--ok, #58e08a)", marginTop: 4 }}>✓ Format {campaign.platform} OK — gotowe do eksportu.</div>
                  : <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 4 }}>⚠ {fmt.errors.slice(0, 2).join(" ")}</div>}
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>UTM/campaign: <code>{campaign.utm.campaign}</code> — to samo ID w linku, leadzie i przychodzie.</div>
              </div>
            );
          })()}

          {out && (
            <div className="journal-card" style={{ marginTop: 10 }}>
              <p style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 14 }}>{out}</p>
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button className="chip" onClick={() => copyWithToast(out, "Reklamy skopiowane ✓")}>📋 Kopiuj</button>
                {canShare && <button className="chip" onClick={share}>📤 Udostępnij</button>}
                <button className="chip" onClick={generate} disabled={busy}>🔄 Inna wersja</button>
              </div>
            </div>
          )}

          {/* 🔗 Builder linków UTM — mierz, która reklama/post/link w bio daje ruch i sprzedaż */}
          <details className="journal-card" style={{ marginTop: 12, padding: "8px 12px" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>🔗 Link z pomiarem (UTM) — reklama, post, bio</summary>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Wklej adres swojej strony i wybierz, skąd kierujesz ruch — JARVIS zrobi link, po którym w Google Analytics zobaczysz, co realnie sprzedaje.
            </p>
            <div className="field">
              <input value={utmUrl} placeholder="Adres strony, np. www.v-ai.pl/oferta" onChange={(e) => setUtmUrl(e.target.value)} />
            </div>
            <div className="chips" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {UTM_PRESETS.map((p) => (
                <button key={p.id} className={`chip ${utmPreset?.id === p.id ? "on" : ""}`} onClick={() => setUtmPreset(p)}>{p.label}</button>
              ))}
            </div>
            <div className="field">
              <input value={utmCampaign} placeholder="Nazwa kampanii (opcjonalnie), np. wiosna-2026" onChange={(e) => setUtmCampaign(e.target.value)} />
            </div>
            {utmLink ? (
              <div className="journal-card" style={{ padding: "8px 10px" }}>
                <p style={{ wordBreak: "break-all", margin: 0, fontSize: 13 }}>{utmLink}</p>
                <button className="chip" style={{ marginTop: 8 }} onClick={() => copyWithToast(utmLink, "Link skopiowany ✓")}>📋 Kopiuj link</button>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12 }}>Podaj adres i wybierz źródło, by zobaczyć gotowy link.</p>
            )}
          </details>
        </div>
  );
  if (embedded) return body;
  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📢 Generator reklam</h2>
        </div>
        {body}
        <div className="panel-foot">
          <button className="btn primary" style={{ width: "100%" }} onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
