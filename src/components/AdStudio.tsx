import { useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { copyWithToast, toast, shareOrCopy } from "../lib/toast";
import { saveContentPost } from "../lib/contentStudio";
import { generateAds, AD_PLATFORMS, AD_GOALS, type AdPlatform, type AdGoal } from "../lib/adStudio";

// 📢 Generator reklam (Faza 0) — gotowe zestawy reklam Google/Meta do skopiowania.
export default function AdStudio({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [platform, setPlatform] = useState<AdPlatform>("google");
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState<AdGoal>("leady/kontakty");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");

  const generate = async () => {
    if (!product.trim()) { toast("Wpisz produkt/usługę."); return; }
    setBusy(true);
    setOut("");
    const r = await generateAds({ platform, product, audience: audience || undefined, goal, budget: budget || undefined });
    setBusy(false);
    if (!r) { toast("Nie udało się wygenerować — sprawdź klucz AI (⚙ → Mózg)."); return; }
    setOut(r);
    saveContentPost(platform === "google" ? "Google Ads" : "Meta Ads", product.trim(), r);
  };

  const canShare = typeof navigator !== "undefined" && !!(navigator as { share?: unknown }).share;
  const share = () => shareOrCopy(out, "Skopiowano — wklej w panelu reklam ✓");

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📢 Generator reklam</h2>
        </div>
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

          <button className="btn primary" style={{ width: "100%" }} onClick={generate} disabled={busy}>
            {busy ? "✍ Tworzę reklamy…" : "✨ Wygeneruj reklamy"}
          </button>

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
        </div>
        <div className="panel-foot">
          <button className="btn primary" style={{ width: "100%" }} onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
