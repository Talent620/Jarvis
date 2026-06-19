import { useRef, useState } from "react";
import { generateImage, humanizeImageError, IMAGE_MODELS_LIST, type ImageModelId } from "../lib/images";
import { capturePhoto } from "../lib/camera";
import { useEscape } from "../hooks/useEscape";
import { store } from "../lib/store";
import { parseKeys } from "../lib/keys";
import Guide from "./Guide";

type Img = { data: string; mediaType: string };
const src = (i: Img) => `data:${i.mediaType};base64,${i.data}`;

// Suwak porównania PRZED/PO — przeciągasz, by zobaczyć efekt edycji (jak na żywo).
function Compare({ before, after }: { before: Img; after: Img }) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const move = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={ref}
      className="compare"
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); move(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons) move(e.clientX); }}
    >
      <img src={src(after)} alt="po" className="compare-img" draggable={false} />
      <div className="compare-clip" style={{ width: `${pos}%` }}>
        <img src={src(before)} alt="przed" className="compare-img" draggable={false} />
        <span className="compare-tag">PRZED</span>
      </div>
      <span className="compare-tag right">PO</span>
      <div className="compare-line" style={{ left: `${pos}%` }}><span>⇆</span></div>
    </div>
  );
}

const PRESETS: { label: string; prompt: string }[] = [
  { label: "🧽 Usuń obiekt/naklejki", prompt: "Usuń naklejki i niechciane obiekty z przedmiotu. Wypełnij miejsce naturalnie — idealnie dopasuj teksturę, kolor, światło i odbicia, tak aby NIE było widać żadnego śladu edycji. Resztę zdjęcia zostaw bez zmian." },
  { label: "🔁 Naklejki → wzór", prompt: "Zamień naklejki na elegancki, jednolity wzór (np. geometryczne paski). Dopasuj perspektywę, cień i odbicia fotorealistycznie, jakby wzór był naprawdę na przedmiocie." },
  { label: "🎨 Zmień kolor", prompt: "Zmień kolor wskazanego elementu na podany (dopisz jaki). Zachowaj materiał, fakturę, odblaski i cienie — realistycznie, bez śladu edycji." },
  { label: "↻ Wyprostuj/obróć", prompt: "Ustaw przedmiot we właściwej orientacji (obróć do góry właściwą stroną / wyprostuj). Zachowaj realistyczną perspektywę, cienie i tło." },
  { label: "🦵 Wymień nogi/elementy", prompt: "Wymień nogi / wskazane elementy mebla na opisane (dopisz na jakie). Dopasuj styl, materiał, proporcje i światło — fotorealistycznie." },
  { label: "🛍 Packshot (e-commerce)", prompt: "Profesjonalny packshot do sklepu: czyste białe tło, studyjne światło, miękkie cienie, idealna ostrość i kolory. Zachowaj przedmiot wiernie." },
  { label: "🏠 Zmień tło/scenę", prompt: "Umieść przedmiot w eleganckiej aranżacji wnętrza. Realistyczne światło, cienie i perspektywa pasujące do nowego otoczenia." },
  { label: "✨ Odśwież/wyczyść", prompt: "Wyczyść przedmiot: usuń kurz, zarysowania i odciski, popraw oświetlenie i ostrość. Zachowaj pełny realizm." },
];

export default function Studio({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  // Domyślnie wybierz lokalny generator, gdy serwer SD jest skonfigurowany (prywatnie, za darmo).
  const [model, setModel] = useState<ImageModelId>(store.settings.sdUrl?.trim() ? "local-sd" : "gemini");
  const [prompt, setPrompt] = useState("");
  const [inputs, setInputs] = useState<Img[]>([]);
  const [history, setHistory] = useState<Img[]>([]); // wersje wyników (ostatnia = bieżąca)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"result" | "compare">("compare");
  const resultRef = useRef<HTMLDivElement>(null); // do auto-przewinięcia po „Przerób"
  const [keysOpen, setKeysOpen] = useState(false);
  const [studioKeys, setStudioKeys] = useState(store.settings.studioKeys || "");
  const studioKeyCount = parseKeys(studioKeys).length;
  // Suwaki jakości dla lokalnego Stable Diffusion.
  const [sdSteps, setSdSteps] = useState(28);
  const [sdSize, setSdSize] = useState(1024);
  const [sdDenoise, setSdDenoise] = useState(0.6);

  const result = history[history.length - 1] || null;
  const before = inputs[0] || null; // zdjęcie wejściowe do porównania

  const attach = async () => {
    const img = await capturePhoto();
    if (img) { setInputs((p) => [...p, img].slice(0, 4)); }
  };

  const run = async (text: string, ins: Img[]) => {
    if (!text.trim()) return;
    setBusy(true);
    setErr("");
    const sdOpts = model === "local-sd" ? { steps: sdSteps, width: sdSize, height: sdSize, denoising: sdDenoise } : undefined;
    const r = await generateImage(text, ins.length ? ins : undefined, model, sdOpts);
    if ("error" in r) setErr(humanizeImageError(r.error, model));
    else {
      setHistory((h) => [...h, r]);
      setView("compare");
      // Pokaż użytkownikowi gdzie jest wynik — przewiń do niego po wygenerowaniu.
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
    setBusy(false);
  };

  const gen = () => run(prompt, inputs);
  const applyPreset = (p: string) => { setPrompt(p); if (inputs.length) void run(p, inputs); };

  // Edytuj dalej: wynik staje się nowym wejściem (łańcuch edycji, jak FLUX Kontext).
  const editFurther = () => {
    if (result) { setInputs([result]); setHistory([]); setPrompt(""); setErr(""); }
  };
  const undo = () => setHistory((h) => h.slice(0, -1));

  const download = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = src(result);
    a.download = `jarvis-edycja-${Date.now()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🎨 Studio Obrazów</h2>
        </div>
        <div className="panel-body">
          {/* Wybór modelu */}
          <div className="chips" style={{ flexWrap: "wrap", marginBottom: 6 }}>
            {IMAGE_MODELS_LIST.map((m) => (
              <button key={m.id} className={`chip ${model === m.id ? "on" : ""}`} onClick={() => setModel(m.id)} disabled={busy}>
                {m.tier === "free" ? "🆓 " : "⭐ "}{m.label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>{IMAGE_MODELS_LIST.find((m) => m.id === model)?.note}</p>
          {model !== "gemini" && model !== "local-sd" && !store.settings.falApiKey?.trim() && (
            <p className="muted" style={{ fontSize: 12, color: "var(--gold)" }}>⭐ Model premium — dodaj klucz fal.ai w ⚙ → AI, aby go użyć.</p>
          )}
          {model === "local-sd" && !store.settings.sdUrl?.trim() && (
            <p className="muted" style={{ fontSize: 12, color: "var(--gold)" }}>🖥 Lokalny generator — uruchom Stable Diffusion (A1111/Forge) na PC i wpisz jego adres w ⚙ → AI (np. http://192.168.0.10:7860).</p>
          )}
          {model === "local-sd" && store.settings.sdUrl?.trim() && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "4px 0 8px" }}>
              <label style={{ fontSize: 12 }}>Jakość (kroki): {sdSteps} <span className="muted">— więcej = ładniej, ale wolniej</span></label>
              <input type="range" min={8} max={50} step={1} value={sdSteps} onChange={(e) => setSdSteps(Number(e.target.value))} disabled={busy} />
              <label style={{ fontSize: 12 }}>Rozmiar: {sdSize}×{sdSize} px</label>
              <input type="range" min={512} max={1536} step={128} value={sdSize} onChange={(e) => setSdSize(Number(e.target.value))} disabled={busy} />
              {inputs.length > 0 && (
                <>
                  <label style={{ fontSize: 12 }}>Siła zmian (edycja zdjęcia): {Math.round(sdDenoise * 100)}% <span className="muted">— niżej = bliżej oryginału</span></label>
                  <input type="range" min={0.2} max={0.95} step={0.05} value={sdDenoise} onChange={(e) => setSdDenoise(Number(e.target.value))} disabled={busy} />
                </>
              )}
            </div>
          )}

          {/* Osobne klucze TYLKO dla Studia — własny dzienny limit obrazów, z rotacją. */}
          {model === "gemini" && (
            <div style={{ margin: "2px 0 8px" }}>
              <button className="chip" onClick={() => setKeysOpen((o) => !o)} disabled={busy}>
                🔑 Klucze Studia (osobne){studioKeyCount ? ` · ${studioKeyCount}` : ""} {keysOpen ? "▲" : "▼"}
              </button>
              {keysOpen && (
                <div className="field" style={{ marginTop: 8 }}>
                  <textarea
                    className="ta"
                    style={{ minHeight: 70 }}
                    value={studioKeys}
                    placeholder={"Wklej 1+ kluczy Gemini — każdy w nowej linii.\nUżywane TYLKO w Studiu. JARVIS rotuje je, gdy limit się wyczerpie."}
                    onChange={(e) => { setStudioKeys(e.target.value); store.setSettings({ studioKeys: e.target.value }); }}
                  />
                  <p className="muted" style={{ fontSize: 12 }}>
                    Darmowe klucze: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: "var(--cyan)" }}>aistudio.google.com/apikey</a> (bez karty). Każde konto Google = osobny dzienny limit obrazów. Puste pole = Studio użyje klucza z czatu.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Zdjęcia wejściowe */}
          {inputs.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0" }}>
              {inputs.map((im, i) => (
                <div key={i} className="img-preview" style={{ margin: 0 }}>
                  <img src={src(im)} alt={`wejście ${i + 1}`} style={{ height: 72 }} />
                  <button className="img-x" onClick={() => setInputs((p) => p.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Presety — scenariusze edycji */}
          <div className="chips" style={{ flexWrap: "wrap", margin: "2px 0 8px" }}>
            {PRESETS.map((p) => (
              <button key={p.label} className="chip" onClick={() => applyPreset(p.prompt)} disabled={busy}>{p.label}</button>
            ))}
          </div>

          <div className="field">
            <textarea
              value={prompt}
              placeholder="Opisz dokładnie, co zmienić — np. zmień kolor blatu na grafitowy, usuń naklejki, nóżki na czarne metalowe…"
              onChange={(e) => setPrompt(e.target.value)}
              className="ta"
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={attach}>📷 Dołącz zdjęcie{inputs.length ? ` (${inputs.length})` : ""}</button>
            <button className="btn primary" style={{ flex: 1 }} onClick={gen} disabled={busy}>{busy ? "Tworzę…" : "✨ Przerób"}</button>
          </div>
          {err && <p className="notice">⚠ {err}</p>}

          {/* Wynik + porównanie przed/po */}
          {result && (
            <div ref={resultRef}>
              <p style={{ fontWeight: 700, color: "var(--cyan)", margin: "12px 0 4px" }}>✅ Gotowe — Twój przerobiony obraz:</p>
              {before && (
                <div className="chips" style={{ marginTop: 10 }}>
                  <button className={`chip ${view === "compare" ? "on" : ""}`} onClick={() => setView("compare")}>⇆ Przed/Po</button>
                  <button className={`chip ${view === "result" ? "on" : ""}`} onClick={() => setView("result")}>🖼 Wynik</button>
                </div>
              )}
              {view === "compare" && before ? (
                <Compare before={before} after={result} />
              ) : (
                <img src={src(result)} alt="wynik" style={{ width: "100%", borderRadius: 12, marginTop: 8, border: "1px solid var(--line-strong)" }} />
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn" style={{ flex: 1 }} onClick={download}>⬇ Pobierz</button>
                <button className="btn" style={{ flex: 1 }} onClick={editFurther}>✏ Edytuj dalej</button>
                {history.length > 1 && <button className="btn" onClick={undo}>↩ Cofnij wersję</button>}
              </div>
              {history.length > 1 && <p className="muted" style={{ fontSize: 12 }}>Wersja {history.length} — możesz cofać i nakładać kolejne zmiany.</p>}
            </div>
          )}

          <Guide title="ℹ Jak osiągnąć efekt nie do poznania">
            <p><b>1. Dołącz zdjęcie</b> przedmiotu (📷). <b>2.</b> Kliknij preset albo opisz zmianę. <b>3.</b> Porównaj suwakiem <b>Przed/Po</b>.</p>
            <p><b>Klucz do realizmu:</b> w opisie proś o <b>dopasowanie światła, cieni, faktury i perspektywy</b> oraz „bez śladu edycji". Zmiany nakładaj <b>krok po kroku</b> („Edytuj dalej") — każdą rzecz osobno, wtedy wychodzi najczyściej.</p>
            <p><b>Darmowy</b> (Gemini Nano Banana) jest świetny do większości edycji. <b>Premium</b> (FLUX Kontext / Nano Banana Pro przez fal.ai) daje najwyższą spójność detali przy wielu poprawkach — wymaga płatnego klucza fal.ai.</p>
          </Guide>
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
