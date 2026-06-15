import { useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { useEscape } from "../hooks/useEscape";
import { copyWithToast, toast, shareOrCopy } from "../lib/toast";
import { generatePost, saveContentPost, PLATFORMS, TONES, type Platform, type Tone } from "../lib/contentStudio";

// 📱 Maszynka do kontentu — JARVIS pisze gotowy post na social media. Kopiujesz
// albo udostępniasz jednym tapnięciem do dowolnej apki (IG/FB/TikTok/LinkedIn).
export default function ContentStudio({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
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
  };

  const canShare = typeof navigator !== "undefined" && !!(navigator as { share?: unknown }).share;
  const share = () => shareOrCopy(out);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📱 Maszynka do kontentu</h2>
        </div>
        <div className="panel-body">
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
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button className="chip" onClick={() => copyWithToast(out, "Post skopiowany ✓")}>📋 Kopiuj</button>
                {canShare && <button className="chip" onClick={share}>📤 Udostępnij</button>}
                <button className="chip" onClick={generate} disabled={busy}>🔄 Inna wersja</button>
              </div>
            </div>
          )}

          {(store.data.contentPosts || []).length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>🕘 Ostatnie posty</h3>
              {(store.data.contentPosts || []).slice(0, 10).map((p) => (
                <div className="journal-card" key={p.id} style={{ marginTop: 6 }}>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {PLATFORMS.find((x) => x.id === p.platform)?.emoji || "📱"} {p.topic || "post"} · {new Date(p.at).toLocaleString("pl-PL")}
                  </div>
                  <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0", fontSize: 13, maxHeight: 80, overflow: "hidden" }}>{p.text}</p>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button className="chip" onClick={() => copyWithToast(p.text, "Skopiowano ✓")}>📋 Kopiuj</button>
                    <button className="chip" onClick={() => { store.setData((d) => { d.contentPosts = (d.contentPosts || []).filter((x) => x.id !== p.id); }); toast("🗑 Usunięto z historii"); }}>🗑</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn primary" style={{ width: "100%" }} onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
