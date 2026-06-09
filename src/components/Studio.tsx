import { useState } from "react";
import { generateImage } from "../lib/images";
import { capturePhoto } from "../lib/camera";

export default function Studio({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [input, setInput] = useState<{ data: string; mediaType: string } | null>(null);
  const [result, setResult] = useState<{ data: string; mediaType: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const attach = async () => {
    const img = await capturePhoto();
    if (img) {
      setInput(img);
      setResult(null);
    }
  };

  const gen = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setErr("");
    const r = await generateImage(prompt, input || undefined);
    if ("error" in r) setErr(r.error);
    else setResult(r);
    setBusy(false);
  };

  const editFurther = () => {
    if (result) {
      setInput(result);
      setResult(null);
    }
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = `data:${result.mediaType};base64,${result.data}`;
    a.download = `jarvis-image-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const src = (i: { data: string; mediaType: string }) => `data:${i.mediaType};base64,${i.data}`;

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🎨 Studio Obrazów</h2>
        </div>
        <div className="panel-body">
          <p className="muted">
            Generuj obrazy z opisu lub <b>edytuj zdjęcie</b> (dołącz je i napisz, co zmienić:
            „zmień tło na kosmos", „dodaj okulary", „w stylu cyberpunk").
          </p>

          {input && (
            <div className="img-preview" style={{ marginBottom: 10 }}>
              <img src={src(input)} alt="wejście" style={{ height: 90 }} />
              <button className="img-x" onClick={() => setInput(null)}>✕</button>
            </div>
          )}

          <div className="field">
            <textarea
              value={prompt}
              placeholder="Opisz obraz albo zmianę…"
              onChange={(e) => setPrompt(e.target.value)}
              style={{ width: "100%", minHeight: 70, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, fontFamily: "inherit", fontSize: 15 }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={attach}>📷 Dołącz zdjęcie</button>
            <button className="btn primary" style={{ flex: 1 }} onClick={gen} disabled={busy}>
              {busy ? "Tworzę…" : "✨ Generuj"}
            </button>
          </div>
          {err && <p className="muted">{err}</p>}

          {result && (
            <>
              <img src={src(result)} alt="wynik" style={{ width: "100%", borderRadius: 12, marginTop: 12, border: "1px solid var(--line-strong)" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn" style={{ flex: 1 }} onClick={download}>⬇ Pobierz</button>
                <button className="btn" style={{ flex: 1 }} onClick={editFurther}>✏ Edytuj dalej</button>
              </div>
            </>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
