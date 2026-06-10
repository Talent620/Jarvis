import { useState } from "react";
import { generateImage } from "../lib/images";
import { capturePhoto } from "../lib/camera";

type Img = { data: string; mediaType: string };

export default function Studio({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [inputs, setInputs] = useState<Img[]>([]);
  const [result, setResult] = useState<Img | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const attach = async () => {
    const img = await capturePhoto();
    if (img) {
      setInputs((prev) => [...prev, img].slice(0, 4)); // do 4 zdjęć referencyjnych
      setResult(null);
    }
  };

  const gen = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setErr("");
    const r = await generateImage(prompt, inputs.length ? inputs : undefined);
    if ("error" in r) setErr(r.error);
    else setResult(r);
    setBusy(false);
  };

  const editFurther = () => {
    if (result) {
      setInputs([result]);
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

  const src = (i: Img) => `data:${i.mediaType};base64,${i.data}`;

  // Presety jednym kliknięciem — wstawiają mocny prompt; z dołączonym zdjęciem od razu generują.
  const PRESETS: { label: string; prompt: string }[] = [
    { label: "💡 Studyjne światło", prompt: "Profesjonalne studyjne oświetlenie portretowe, miękkie cienie, wysoki detal, fotorealizm. Zachowaj twarz i rysy bez zmian." },
    { label: "🌃 Cyberpunk", prompt: "Przekształć w styl cyberpunk: neony, deszcz, nocne miasto, refleksy. Zachowaj tożsamość osoby." },
    { label: "✂ Usuń tło", prompt: "Usuń tło całkowicie, pozostaw przezroczyste/czyste białe tło, dokładne krawędzie." },
    { label: "🖼 Renowacja", prompt: "Odrestauruj stare/zniszczone zdjęcie: usuń rysy i szum, popraw ostrość i kolory, naturalny efekt." },
    { label: "🎨 Anime", prompt: "Przekształć w wysokiej jakości styl anime, zachowując kompozycję i tożsamość." },
    { label: "📈 4K Upscale", prompt: "Zwiększ jakość i szczegółowość do poziomu 4K, wyostrz detale, popraw teksturę, bez zniekształceń." },
    { label: "👔 Pro headshot", prompt: "Zamień w profesjonalne zdjęcie biznesowe (LinkedIn): elegancki strój, neutralne tło, studyjne światło. Zachowaj twarz." },
    { label: "☀ Popraw światło", prompt: "Popraw ekspozycję, balans bieli i kontrast, naturalnie rozjaśnij. Nie zmieniaj treści." },
  ];

  const applyPreset = async (p: string) => {
    setPrompt(p);
    if (inputs.length) {
      setBusy(true);
      setErr("");
      const r = await generateImage(p, inputs);
      if ("error" in r) setErr(r.error);
      else setResult(r);
      setBusy(false);
    }
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🎨 Studio Obrazów</h2>
        </div>
        <div className="panel-body">
          <p className="muted">
            Najwyższej klasy generowanie i <b>precyzyjna edycja</b> (Gemini 2.5 Flash Image).
            Dołącz zdjęcie/zdjęcia i opisz dokładnie, co zmienić — np. „zmień tło na nocny
            Tokio w deszczu", „dodaj skórzaną kurtkę i okulary", „popraw światło, zachowaj twarz",
            „połącz osobę z 1. zdjęcia z tłem z 2.". Możesz zmieniać każdy detal, krok po kroku.
          </p>

          {inputs.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {inputs.map((im, i) => (
                <div key={i} className="img-preview" style={{ margin: 0 }}>
                  <img src={src(im)} alt={`wejście ${i + 1}`} style={{ height: 80 }} />
                  <button className="img-x" onClick={() => setInputs((p) => p.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="chips" style={{ flexWrap: "wrap", margin: "2px 0 8px" }}>
            {PRESETS.map((p) => (
              <button key={p.label} className="chip" onClick={() => applyPreset(p.prompt)} disabled={busy}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="field">
            <textarea
              value={prompt}
              placeholder="Opisz obraz albo dokładną zmianę…"
              onChange={(e) => setPrompt(e.target.value)}
              style={{ width: "100%", minHeight: 80, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, fontFamily: "inherit", fontSize: 15 }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={attach}>
              📷 Dołącz zdjęcie{inputs.length ? ` (${inputs.length})` : ""}
            </button>
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
