import { useEffect, useRef, useState } from "react";
import { generateImage, humanizeImageError, bestImageModel, IMAGE_MODELS_LIST, type ImageModelId } from "../lib/images";
import { capturePhoto } from "../lib/camera";
import { useEscape } from "../hooks/useEscape";
import { store } from "../lib/store";
import { parseKeys } from "../lib/keys";
import { refineEdit, type EditPlan } from "../lib/editAssistant";
import { loadUsage } from "../lib/usageTelemetry";
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
  // Domyślnie najlepszy DOSTĘPNY generator: serwer SD > Gemini (klucz) > darmowy bez klucza.
  // Dzięki temu Studio działa od razu, nawet bez żadnej konfiguracji (Pollinations).
  const [model, setModel] = useState<ImageModelId>(bestImageModel());
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
  const [sdProgress, setSdProgress] = useState(0); // 0..1, postęp lokalnego generowania
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const result = history[history.length - 1] || null;
  const before = inputs[0] || null; // zdjęcie wejściowe do porównania
  // 💸 Licznik wydatków na płatne obrazy (fal.ai) — recompute na każdy render (po każdej generacji
   // history się zmienia → odświeża). Pełne statystyki: Więcej → Koszty AI.
  void history.length;
  const imgSpend = loadUsage().filter((u) => u.provider === ("fal" as never)).reduce((s, u) => s + (u.costUsd || 0), 0);

  const attach = async () => {
    const img = await capturePhoto();
    if (img) {
      setInputs((p) => [...p, img].slice(0, 4));
      // Dołączasz zdjęcie = chcesz EDYCJĘ. Pollinations tworzy obraz z opisu i NIE edytuje —
      // jeśli jest skonfigurowany edytor (Gemini/SD), przeskocz na niego, by wynik pasował.
      if (model === "pollinations") {
        const edit = bestImageModel();
        if (edit !== "pollinations") setModel(edit);
      }
    }
  };

  const run = async (text: string, ins: Img[]) => {
    if (!text.trim()) return;
    setBusy(true);
    setErr("");
    const sdOpts =
      model === "local-sd" ? { steps: sdSteps, width: sdSize, height: sdSize, denoising: sdDenoise }
      : model === "pollinations" ? { width: sdSize, height: sdSize }
      : undefined;
    if (model === "local-sd") setSdProgress(0);
    // Strażnik odmontowania: jeśli użytkownik zamknie Studio w trakcie, nie ruszamy stanu.
    const onProg = model === "local-sd" ? (p: number) => { if (mounted.current) setSdProgress(p); } : undefined;
    const r = await generateImage(text, ins.length ? ins : undefined, model, sdOpts, onProg);
    if (!mounted.current) return;
    setSdProgress(0);
    if ("error" in r) setErr(humanizeImageError(r.error, model));
    else {
      setHistory((h) => [...h, r]);
      setView("compare");
      // Pokaż użytkownikowi gdzie jest wynik — przewiń do niego po wygenerowaniu.
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
    setBusy(false);
  };

  // 💬 Asystent edycji: zanim wydamy kasę na (płatną) generację, darmowy mózg rozumie polecenie
  // i dopytuje, jeśli coś niejasne. Domyślnie włączony — chroni przed marnowaniem prób.
  const [assist, setAssist] = useState(true);
  const [plan, setPlan] = useState<(EditPlan & { instruction?: string }) | null>(null);
  const [assistBusy, setAssistBusy] = useState(false);
  const [clarifyAns, setClarifyAns] = useState("");

  const startAssist = async (instruction: string) => {
    if (!instruction.trim()) return;
    setAssistBusy(true); setErr(""); setPlan(null);
    const p = await refineEdit(instruction.trim(), inputs.length > 0);
    if (!mounted.current) return;
    setAssistBusy(false);
    setPlan({ ...p, instruction: instruction.trim() });
  };
  const answerClarify = () => {
    if (!clarifyAns.trim() || !plan?.instruction) return;
    const merged = `${plan.instruction}\nDoprecyzowanie: ${clarifyAns.trim()}`;
    setClarifyAns("");
    void startAssist(merged);
  };
  const confirmGen = () => {
    const p = plan?.prompt;
    setPlan(null);
    if (p) void run(p, inputs);
  };

  // „Przerób": z asystentem najpierw zrozum/dopytaj; bez asystenta — generuj wprost.
  const gen = () => { if (assist) void startAssist(prompt); else void run(prompt, inputs); };
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
          {imgSpend > 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 0, color: "var(--gold)" }}>
              💸 Wydano na obrazy (fal.ai): ${imgSpend.toFixed(2)} · pełne statystyki: ⋯ Więcej → „Koszty AI"
            </p>
          )}
          {(model === "fal-flux-kontext" || model === "fal-nano-banana") && !store.settings.falApiKey?.trim() && (
            <p className="muted" style={{ fontSize: 12, color: "var(--gold)" }}>⭐ Model premium — dodaj klucz fal.ai w ⚙ → AI, aby go użyć.</p>
          )}
          {model === "pollinations" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "4px 0 8px" }}>
              {inputs.length > 0 && (
                <p className="muted" style={{ fontSize: 12, color: "var(--gold)" }}>ℹ Darmowy generator tworzy NOWY obraz z opisu (nie edytuje dołączonego zdjęcia). Do edycji zdjęć użyj Gemini lub modelu premium.</p>
              )}
              <label style={{ fontSize: 12 }}>Rozmiar: {sdSize}×{sdSize} px</label>
              <input type="range" min={512} max={1536} step={128} value={sdSize} onChange={(e) => setSdSize(Number(e.target.value))} disabled={busy} />
            </div>
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
                  {studioKeys.trim() && !/AIza/i.test(studioKeys) && studioKeys.includes(":") && (
                    <p className="muted" style={{ fontSize: 12, color: "#ff8585" }}>
                      ⚠ To wygląda na klucz <b>fal.ai</b> (z dwukropkiem), a tu wpisuje się klucze <b>Gemini</b> (zaczynają się od „AIza…”).
                      Klucz fal.ai wklej w <b>⚙ → AI → Studio premium</b>, a tu wstaw klucz Gemini z aistudio.google.com/apikey.
                    </p>
                  )}
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

          {/* 💬 Asystent edycji — rozumie polecenie i dopyta, zanim wyda kasę na generację. */}
          <button className={`chip ${assist ? "on" : ""}`} style={{ marginBottom: 6 }} onClick={() => setAssist((a) => !a)} disabled={busy || assistBusy} title="Mózg najpierw zrozumie i dopyta, jeśli coś niejasne — nie marnujesz płatnych prób">
            {assist ? "💬 Asystent: dopytuje przed generacją ✓" : "💬 Asystent: wyłączony"}
          </button>

          <div className="field">
            <textarea
              value={prompt}
              placeholder="Powiedz po ludzku, co zmienić — np. „wysuń 2 papierosy i zamień napis »palenie niszczy« na www.v-ai.pl Marcin Kubicki”."
              onChange={(e) => setPrompt(e.target.value)}
              className="ta"
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={attach}>📷 Dołącz zdjęcie{inputs.length ? ` (${inputs.length})` : ""}</button>
            <button className="btn primary" style={{ flex: 1 }} onClick={gen} disabled={busy}>
              {busy ? (model === "local-sd" && sdProgress > 0 ? `Tworzę… ${Math.round(sdProgress * 100)}%` : "Tworzę…") : "✨ Przerób"}
            </button>
          </div>
          {busy && model === "local-sd" && (
            <div style={{ height: 4, background: "rgba(108,231,255,.15)", borderRadius: 4, overflow: "hidden", margin: "2px 0 6px" }}>
              <div style={{ height: "100%", width: `${Math.round(sdProgress * 100)}%`, background: "var(--cyan)", transition: "width .3s" }} />
            </div>
          )}
          {assistBusy && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>🤖 Rozumiem Twoje polecenie…</p>}

          {/* 🤖 Asystent: pytanie doprecyzowujące ALBO potwierdzenie „tak zrozumiałem" + Generuj */}
          {plan && !assistBusy && (
            <div className="journal-card" style={{ padding: "10px 12px", marginTop: 8, border: "1px solid var(--cyan)" }}>
              {plan.ready ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>🤖 Zrozumiałem tak:</div>
                  <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>{plan.summary || plan.prompt}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button className="btn primary" style={{ flex: 1 }} onClick={confirmGen} disabled={busy}>
                      ✅ Generuj{model === "fal-flux-kontext" || model === "fal-nano-banana" ? " (płatne ~$0.04–0.08)" : ""}
                    </button>
                    <button className="btn" onClick={() => setPlan(null)}>✏ Popraw opis</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>🤖 Dopytam, żeby nie zmarnować generacji:</div>
                  <p style={{ fontSize: 13, marginTop: 4 }}>{plan.question}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input
                      className="ta"
                      style={{ flex: 1, minHeight: 0, padding: "8px 10px" }}
                      value={clarifyAns}
                      placeholder="Twoja odpowiedź…"
                      autoFocus
                      onChange={(e) => setClarifyAns(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && answerClarify()}
                    />
                    <button className="btn primary" style={{ width: "auto" }} onClick={answerClarify} disabled={!clarifyAns.trim()}>➤</button>
                  </div>
                </>
              )}
            </div>
          )}

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
