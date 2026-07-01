import { useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import Modal from "./Modal";
import { copyWithToast, toast, shareOrCopy } from "../lib/toast";
import { generatePost, saveContentPost, markContentPublished, isPublished, contentStatusOf, CONTENT_STATUS_LABEL, PLATFORMS, TONES, type Platform, type Tone } from "../lib/contentStudio";
import { viralityScore } from "../lib/virality";
import { assessSocialFit } from "../lib/socialFit";
import { buildOrganicCampaign } from "../lib/adCampaign";
import { saveCampaign } from "../lib/campaignStore";
import { uid } from "../lib/store";

// 📱 Maszynka do kontentu — JARVIS pisze gotowy post na social media. Kopiujesz
// albo udostępniasz jednym tapnięciem do dowolnej apki (IG/FB/TikTok/LinkedIn).
export default function ContentStudio({ onClose, embedded }: { onClose: () => void; embedded?: boolean }) {
  useStore();
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<Tone>("swobodny");
  const [brand, setBrand] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");

  const generate = async () => {
    if (!topic.trim()) { toast("Wpisz temat posta."); return; }
    setBusy(true);
    setOut("");
    const r = await generatePost({ platform, topic, tone, brand: brand || undefined });
    setBusy(false);
    if (!r) { toast("Nie udało się wygenerować — sprawdź klucz AI (⚙ → Mózg)."); return; }
    setOut(r);
    saveContentPost(platform, topic.trim(), r);
    // Post organiczny rejestrujemy też jako kampanię organic_post (INNA operacja niż reklama płatna) —
    // dzięki wspólnemu ID (utm.campaign) organic również może wejść do pętli ROI. Publikacja i tak
    // pozostaje w osobnym, uczciwym cyklu statusów treści (SIMULATED/PUBLISHED) — tu tylko model.
    saveCampaign(buildOrganicCampaign({ id: uid(), channel: platform, topic: topic.trim(), text: r, now: Date.now() }));
  };

  const canShare = typeof navigator !== "undefined" && !!(navigator as { share?: unknown }).share;
  const share = () => shareOrCopy(out);

  const body = (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Podaj temat — JARVIS napisze gotowy post. Potem skopiuj albo udostępnij do dowolnej apki.
          </p>

          <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
            {PLATFORMS.map((p) => (
              <button key={p.id} className={`chip ${platform === p.id ? "on" : ""}`} onClick={() => setPlatform(p.id)}>
                {p.emoji} {p.label}
              </button>
            ))}
          </div>

          <div className="field">
            <textarea
              className="ta"
              rows={2}
              value={topic}
              placeholder="Temat, np. „promocja szparagów w ten weekend” albo „kulisy pracy w studiu”"
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div className="field" style={{ display: "flex", gap: 8 }}>
            <select value={tone} onChange={(e) => setTone(e.target.value as Tone)} style={{ flex: 1 }}>
              {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={brand} placeholder="Marka/firma (opcjonalnie)" onChange={(e) => setBrand(e.target.value)} style={{ flex: 1 }} />
          </div>

          <button className="btn primary" style={{ width: "100%" }} onClick={generate} disabled={busy}>
            {busy ? "✍ Piszę post…" : "✨ Wygeneruj post"}
          </button>

          {out && (
            <div className="journal-card" style={{ marginTop: 10 }}>
              <p style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 14 }}>{out}</p>
              {/* 🔥 Virality Optimizer — potencjał wiralności + wskazówki */}
              {(() => {
                const v = viralityScore(out);
                return (
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: v.score >= 85 ? "#39d98a" : v.score >= 60 ? "var(--gold)" : "#ff6b6b" }}>🔥 Wiralność: {v.score}/100 · {v.grade}</span>
                    {v.tips.length > 0 && <div className="muted" style={{ marginTop: 2 }}>Wzmocnij: {v.tips.slice(0, 2).join(" ")}</div>}
                  </div>
                );
              })()}
              {/* 📐 Social Fit — dopasowanie do platformy (długość, próg widoczności, liczba hashtagów) */}
              {(() => {
                const f = assessSocialFit(platform, out);
                return (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: f.issues.length === 0 ? "#39d98a" : "var(--gold)" }}>📐 Dopasowanie: {f.len} zn. · {f.hashtags} #</span>
                    {f.issues.length > 0 && <div className="muted" style={{ marginTop: 2 }}>{f.issues.slice(0, 2).join(" ")}</div>}
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button className="chip" onClick={() => copyWithToast(out, "Post skopiowany ✓")}>📋 Kopiuj</button>
                {canShare && <button className="chip" onClick={share}>📤 Udostępnij</button>}
                <button className="chip" onClick={generate} disabled={busy}>🔄 Inna wersja</button>
              </div>
            </div>
          )}

          {(store.data.contentPosts || []).length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>🗂 Drafty i publikacje</h3>
              {(store.data.contentPosts || []).slice(0, 10).map((p) => (
                <div className="journal-card" key={p.id} style={{ marginTop: 6 }}>
                  <div className="muted" style={{ fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{PLATFORMS.find((x) => x.id === p.platform)?.emoji || "📱"} {p.topic || "post"} · {new Date(p.at).toLocaleString("pl-PL")}</span>
                    <span style={{ fontWeight: 700, color: isPublished(p) ? "#39d98a" : "var(--gold)" }}>{isPublished(p) ? "✅ " : "✍ "}{CONTENT_STATUS_LABEL[contentStatusOf(p)]}</span>
                  </div>
                  <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0", fontSize: 13, maxHeight: 80, overflow: "hidden" }}>{p.text}</p>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button className="chip" onClick={() => copyWithToast(p.text, "Skopiowano ✓")}>📋 Kopiuj</button>
                    {!isPublished(p) && <button className="chip" style={{ borderColor: "#39d98a" }} onClick={() => { markContentPublished(p.id); toast("✅ Oznaczono jako opublikowane"); }} title="Ręczne potwierdzenie publikacji">✅ Opublikowane</button>}
                    <button className="chip" onClick={() => { store.setData((d) => { d.contentPosts = (d.contentPosts || []).filter((x) => x.id !== p.id); }); toast("🗑 Usunięto z historii"); }}>🗑</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
  );
  if (embedded) return <div className="panel-body">{body}</div>;
  return (
    <Modal
      title="📱 Maszynka do kontentu"
      onClose={onClose}
      foot={<button className="btn primary" style={{ width: "100%" }} onClick={onClose}>Zamknij</button>}
    >
      {body}
    </Modal>
  );
}
