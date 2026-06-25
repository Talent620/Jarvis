import { useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { copyWithToast, toast, shareOrCopy } from "../lib/toast";
import { saveContentPost } from "../lib/contentStudio";
import { generateAds, AD_PLATFORMS, AD_GOALS, type AdPlatform, type AdGoal } from "../lib/adStudio";
import { AD_ANGLES, adAngleGuide } from "../lib/adAngles";
import { scoreAdCopy, adQualityLabel } from "../lib/adQuality";

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
  const [angle, setAngle] = useState(""); // kąt emocjonalny (Ad Creative Engine)

  const generate = async () => {
    if (!product.trim()) { toast("Wpisz produkt/usługę."); return; }
    setBusy(true);
    setOut("");
    const r = await generateAds({ platform, product, audience: audience || undefined, goal, budget: budget || undefined, angle: adAngleGuide(angle) || undefined });
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
