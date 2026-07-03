import { useEffect, useRef, useState } from "react";
import { generateImage, humanizeImageError, bestImageModel, imageModelCost, IMAGE_MODELS_LIST, type ImageModelId } from "../lib/images";
import { brandImageSuffix } from "../lib/brandKit";
import { enhanceImagePrompt, IMAGE_STYLES, type ImageStyle } from "../lib/imagePrompt";
import { capturePhoto } from "../lib/camera";
import { useEscape } from "../hooks/useEscape";
import { usePersistentState } from "../hooks/usePersistentState";
import { store } from "../lib/store";
import { parseKeys } from "../lib/keys";
import { toast } from "../lib/toast";
import { refineEdit, type EditPlan } from "../lib/editAssistant";
import { loadUsage } from "../lib/usageTelemetry";
import { saveImageEdit, listImageHistory, removeImageEdit } from "../lib/imageHistory";
import { buildZip, base64ToBytes } from "../lib/zip";
import type { ImageEdit } from "../types";
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
  { label: "🛍 Packshot (białe tło)", prompt: "Profesjonalny packshot e-commerce: WYTNIJ sam przedmiot z otoczenia i umieść na czystym, jednolitym BIAŁYM tle, wyśrodkowany. Zachowaj TEN SAM przedmiot — jego kształt, proporcje i perspektywę; nie zmieniaj geometrii ani nie obracaj. Jasne, równomierne studyjne światło, miękki cień pod przedmiotem, wysoka ostrość, realistyczne kolory; NIE przyciemniaj. Zachowaj oryginalne napisy i etykiety wiernie. Fotorealistycznie, bez śladu edycji, jak zdjęcie katalogowe." },
  { label: "🆕 Odnów (jak nowy)", prompt: "Odnów przedmiot do stanu jak nowy: usuń brud, kurz, zarysowania, odciski i przebarwienia z metalu i plastiku. Zachowaj IDENTYCZNY przedmiot, kształt, kadr, kąt i perspektywę — nie przesuwaj, nie obracaj, nie zmieniaj geometrii. Jasne, równomierne światło, czyste realistyczne kolory, wysoka ostrość. Zachowaj wszystkie napisy i etykiety bez zmian. Fotorealistycznie, bez śladu edycji, nie twórz nowej sceny." },
  { label: "🏠 Zmień tło/scenę", prompt: "Umieść przedmiot w eleganckiej aranżacji wnętrza. Zachowaj ten sam przedmiot, jego kształt i perspektywę bez zmian. Realistyczne światło, cienie i perspektywa pasujące do nowego otoczenia, fotorealistycznie." },
  { label: "✨ Odśwież/wyczyść", prompt: "Wyczyść przedmiot: usuń kurz, zarysowania i odciski, popraw oświetlenie i ostrość. Zachowaj IDENTYCZNY przedmiot, kadr i perspektywę — nie zmieniaj geometrii. Pełny realizm, bez śladu edycji." },
];

export default function Studio({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  // Domyślnie najlepszy DOSTĘPNY generator: serwer SD > Gemini (klucz) > darmowy bez klucza.
  // Dzięki temu Studio działa od razu, nawet bez żadnej konfiguracji (Pollinations).
  // Trwała sesja funkcji: opis/styl/model przeżywają wyjście z panelu i zamknięcie apki.
  // Obrazy (inputs/history) celowo NIE — bloby są za duże na localStorage (mają swoją historię w IndexedDB).
  const [model, setModel] = usePersistentState<ImageModelId>("studio.model", () => bestImageModel());
  // Odtworzony szkic mógł zapamiętać model, którego już nie ma w katalogu (stara wersja apki)
  // — wtedy wróć do najlepszego dostępnego zamiast strzelać błędem generacji.
  useEffect(() => {
    if (!IMAGE_MODELS_LIST.some((m) => m.id === model)) setModel(bestImageModel());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [prompt, setPrompt] = usePersistentState("studio.prompt", "");
  const [inputs, setInputs] = useState<Img[]>([]);
  const [imgStyle, setImgStyle] = usePersistentState<ImageStyle>("studio.imgStyle", "auto"); // kierunek artystyczny dla generacji z opisu
  const [history, setHistory] = useState<Img[]>([]); // wersje wyników (ostatnia = bieżąca)
  const [hist, setHist] = useState<ImageEdit[]>(listImageHistory()); // trwała historia przeróbek
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"result" | "compare">("compare");
  const resultRef = useRef<HTMLDivElement>(null); // do auto-przewinięcia po „Przerób"
  const [keysOpen, setKeysOpen] = useState(false);
  const [studioKeys, setStudioKeys] = useState(store.settings.studioKeys || "");
  const studioKeyCount = parseKeys(studioKeys).length;
  // Suwaki jakości dla lokalnego Stable Diffusion — też trwałe (ustawienia robocze użytkownika).
  const [sdSteps, setSdSteps] = usePersistentState("studio.sdSteps", 28);
  const [sdSize, setSdSize] = usePersistentState("studio.sdSize", 1024);
  const [sdDenoise, setSdDenoise] = usePersistentState("studio.sdDenoise", 0.6);
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
      // Dołączasz zdjęcie = chcesz EDYCJĘ. Wybierz najlepszy SKONFIGUROWANY edytor: fal.ai (jeśli masz
      // klucz) — płatny, niezawodny; inaczej Gemini/SD. Pollinations tworzy z opisu i NIE edytuje.
      // Nie nadpisujemy świadomego wyboru płatnego/lokalnego modelu — tylko podnosimy z darmowych domyślnych.
      const edit = bestImageModel(true);
      if (edit !== model && (model === "pollinations" || (model === "gemini" && edit.startsWith("fal-")))) {
        setModel(edit);
        if (edit.startsWith("fal-")) toast("Edycja przez fal.ai (płatne ~$0.04/obraz). Wolisz za darmo? Wybierz 🆓 Gemini wyżej.");
      }
    }
  };

  // Usunięcie zdjęcia wejściowego. Gdy znika OSTATNIE, a wybrany jest model fal.ai (edytuje tylko
  // istniejące zdjęcie) — zejdź na model do generowania z opisu, by „Generuj" nie utknął na
  // komunikacie „najpierw dołącz zdjęcie".
  const removeInput = (i: number) => {
    setInputs((p) => p.filter((_, j) => j !== i));
    if (inputs.length <= 1 && (model === "fal-flux-kontext" || model === "fal-nano-banana")) setModel(bestImageModel(false));
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
    // Dla generacji z OPISU: wzmocnij prompt (jakość/styl) + dolej markę. Przy edycji zdjęcia pomijamy.
    const promptBrand = ins.length ? text : enhanceImagePrompt(text, imgStyle) + brandImageSuffix();
    const r = await generateImage(promptBrand, ins.length ? ins : undefined, model, sdOpts, onProg);
    if (!mounted.current) return;
    setSdProgress(0);
    if ("error" in r) {
      // 🛟 Auto-fallback: płatny fal.ai padł na braku środków/autoryzacji → dokończ DARMOWYM Gemini,
      // żebyś DOSTAŁ wynik zamiast samego błędu. Tylko gdy jest klucz Gemini i mamy zdjęcie do edycji.
      const falDown = (model === "fal-nano-banana" || model === "fal-flux-kontext")
        && /środków|limit|fund|credit|billing|auth|forbidden|\b(401|402|403)\b/i.test(r.error);
      const geminiReady = !!store.settings.keys?.gemini?.trim() || !!store.settings.studioKeys?.trim();
      if (falDown && geminiReady && ins.length) {
        const r2 = await generateImage(text, ins, "gemini");
        if (!mounted.current) return;
        if (!("error" in r2)) {
          setModel("gemini");
          setHistory((h) => [...h, r2]);
          saveImageEdit(r2, text); setHist(listImageHistory());
          setView("compare");
          toast("⚠ fal.ai niedostępny (brak środków) — zrobiłem DARMOWYM Gemini ✓");
          setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
          setBusy(false);
          return;
        }
        // Awaryjny Gemini też padł — pokaż OBA powody, NAJPIERW płatny fal.ai (to wybrany model),
        // żeby nie zwalać winy na „limit Gemini", gdy realnie odmówił fal.ai (np. brak billingu/środków
        // na koncie fal.ai). Inaczej komunikat myli: każe wybrać fal.ai, który już jest wybrany.
        setErr(`Płatny fal.ai odmówił, więc spróbowałem awaryjnie darmowym Gemini — ale i on nie dał rady.\n• fal.ai: ${humanizeImageError(r.error, model)}\n• Gemini (awaryjnie): ${humanizeImageError(r2.error, "gemini")}\n\nSprawdź na fal.ai, czy klucz jest ważny i masz włączony billing/środki — wtedy edycja pójdzie płatnym fal.ai bez Gemini.`);
        setBusy(false);
        return;
      }
      setErr(humanizeImageError(r.error, model));
    } else {
      setHistory((h) => [...h, r]);
      saveImageEdit(r, text); setHist(listImageHistory()); // zapisz do trwałej historii przeróbek
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
    // Asystent korzysta z TEKSTOWEGO mózgu. Gdy mózg jest offline/wolny (np. lokalna Ollama
    // nieosiągalna — „Failed to connect"), nie każ czekać na pełny timeout sieci (do 120 s):
    // po 15 s przejdź wprost do generacji z surowym poleceniem (i tak potwierdzasz przyciskiem).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fallback = new Promise<EditPlan & { _skipped?: true }>((resolve) => {
      timer = setTimeout(() => resolve({ ready: true, prompt: instruction.trim(), _skipped: true }), 15000);
    });
    const p = await Promise.race([refineEdit(instruction.trim(), inputs.length > 0), fallback]);
    if (timer) clearTimeout(timer);
    if (!mounted.current) return;
    setAssistBusy(false);
    if ((p as { _skipped?: true })._skipped) toast("Asystent nie odpowiada (mózg offline?) — generuję wprost. Możesz go wyłączyć przyciskiem 💬.");
    setPlan({ ready: p.ready, prompt: p.prompt, summary: p.summary, question: p.question, instruction: instruction.trim() });
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

  // ✅ Przejrzystość: czy dany model JEST GOTOWY (ma klucz/serwer), zanim go wybierzesz.
  const modelReady = (id: ImageModelId): boolean => {
    const s = store.settings;
    if (id === "pollinations") return true; // darmowy, bez klucza
    if (id === "gemini") return !!s.keys?.gemini?.trim() || !!s.studioKeys?.trim();
    if (id === "local-sd") return !!s.sdUrl?.trim();
    return !!s.falApiKey?.trim(); // fal-flux-kontext / fal-nano-banana
  };

  // „Przerób": z asystentem najpierw zrozum/dopytaj; bez asystenta — generuj wprost.
  const gen = () => { if (assist) void startAssist(prompt); else void run(prompt, inputs); };
  const applyPreset = (p: string) => { setPrompt(p); if (inputs.length) void run(p, inputs); };

  // Edytuj dalej: wynik staje się nowym wejściem (łańcuch edycji, jak FLUX Kontext).
  const editFurther = () => {
    if (result) { setInputs([result]); setHistory([]); setPrompt(""); setErr(""); }
  };
  const undo = () => setHistory((h) => h.slice(0, -1));

  // 🕘 Historia przeróbek: wczytaj zapisany wynik jako nowe WEJŚCIE (edytuj dalej) albo usuń.
  const loadFromHistory = (it: ImageEdit) => {
    setInputs([{ data: it.data, mediaType: it.mediaType }]);
    setHistory([]); setPrompt(""); setErr(""); setView("compare");
    const edit = bestImageModel(true);
    if (model === "pollinations" || (model === "gemini" && edit.startsWith("fal-"))) setModel(edit);
    toast("Wczytano z historii — opisz kolejną zmianę i Przerób.");
  };
  const delHist = (id: string) => { removeImageEdit(id); setHist(listImageHistory()); };

  const triggerDownload = (href: string, name: string, revoke = false) => {
    const a = document.createElement("a");
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    if (revoke) setTimeout(() => URL.revokeObjectURL(href), 2000);
  };
  const download = () => { if (result) triggerDownload(src(result), `jarvis-edycja-${Date.now()}.png`); };

  // ⬇ Eksport bieżącego wyniku w wybranym formacie (konwersja przez canvas). JPG bez przezroczystości.
  const downloadAs = (mime: "image/jpeg" | "image/webp", ext: "jpg" | "webp") => {
    if (!result) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || 1024; c.height = img.naturalHeight || 1024;
      const ctx = c.getContext("2d");
      if (!ctx) { toast("Konwersja niedostępna w tym środowisku."); return; }
      if (mime === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0);
      triggerDownload(c.toDataURL(mime, 0.92), `jarvis-edycja-${Date.now()}.${ext}`);
    };
    img.onerror = () => toast("Nie udało się skonwertować obrazu.");
    img.src = src(result);
  };

  // ⬇ Pobierz CAŁĄ galerię jednym plikiem ZIP (pełna rozdzielczość, oryginalne formaty).
  const downloadZip = () => {
    if (!hist.length) return;
    const extOf = (m: string) => (/jpe?g/i.test(m) ? "jpg" : /webp/i.test(m) ? "webp" : "png");
    const entries = hist.map((it, i) => ({ name: `jarvis-${String(i + 1).padStart(2, "0")}.${extOf(it.mediaType)}`, data: base64ToBytes(it.data) }));
    const blob = new Blob([buildZip(entries) as unknown as BlobPart], { type: "application/zip" });
    triggerDownload(URL.createObjectURL(blob), `galeria-jarvis-${Date.now()}.zip`, true);
    toast(`📦 Spakowano ${entries.length} obraz(y) do ZIP.`);
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
          <div className="chips" style={{ flexWrap: "wrap", marginBottom: 4 }}>
            {IMAGE_MODELS_LIST.map((m) => {
              const cost = imageModelCost(m.id);
              return (
                <button key={m.id} className={`chip ${model === m.id ? "on" : ""}`} onClick={() => setModel(m.id)} disabled={busy} title={modelReady(m.id) ? "Gotowy — masz klucz/serwer" : "Wymaga konfiguracji (klucz/serwer)"}>
                  {m.tier === "free" ? "🆓 " : "⭐ "}{m.label}{cost ? ` · ~$${cost.toFixed(2)}` : ""} {modelReady(m.id) ? "✅" : "⚙"}
                </button>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 0, marginBottom: 6 }}>🆓 darmowy · ⭐ płatny (cena za obraz) · ✅ gotowe · ⚙ wymaga klucza/serwera (kliknij, by zobaczyć jak)</p>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>{IMAGE_MODELS_LIST.find((m) => m.id === model)?.note}</p>
          {/* 🎨 Kierunek artystyczny (wzmacnia prompt jakością/stylem) — tylko przy generacji z OPISU */}
          {inputs.length === 0 && (
            <div style={{ margin: "2px 0 4px" }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>🎨 Styl (wzmacnia jakość promptu)</div>
              <div className="chips" style={{ flexWrap: "wrap", gap: 6 }}>
                {IMAGE_STYLES.map((s) => (
                  <button key={s.id} className={`chip ${imgStyle === s.id ? "on" : ""}`} onClick={() => setImgStyle(s.id)} disabled={busy}>{s.label}</button>
                ))}
              </div>
            </div>
          )}
          {imageModelCost(model) > 0 && (
            <p style={{ fontSize: 12.5, marginTop: 2, color: "var(--gold)", fontWeight: 600 }}>
              💳 Następna generacja: ~${imageModelCost(model).toFixed(2)} (płatne fal.ai). Darmowo? Wybierz 🆓 wyżej.
            </p>
          )}
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
                  <button className="img-x" onClick={() => removeInput(i)}>✕</button>
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
              <div className="chips" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
                <button className="chip" onClick={download}>⬇ PNG</button>
                <button className="chip" onClick={() => downloadAs("image/jpeg", "jpg")}>⬇ JPG</button>
                <button className="chip" onClick={() => downloadAs("image/webp", "webp")}>⬇ WEBP</button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn" style={{ flex: 1 }} onClick={editFurther}>✏ Edytuj dalej</button>
                {history.length > 1 && <button className="btn" onClick={undo}>↩ Cofnij wersję</button>}
              </div>
              {history.length > 1 && <p className="muted" style={{ fontSize: 12 }}>Wersja {history.length} — możesz cofać i nakładać kolejne zmiany.</p>}
            </div>
          )}

          {/* 🕘 Historia przeróbek — trwała (przeżywa zamknięcie Studia). Dotknij = weź do dalszej edycji. */}
          {hist.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <p style={{ fontWeight: 700, color: "var(--cyan)", margin: "0 0 4px", fontSize: 13 }}>🕘 Historia przeróbek ({hist.length})</p>
                <button className="chip" onClick={downloadZip}>📦 Pobierz całość (ZIP)</button>
              </div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 0", WebkitOverflowScrolling: "touch", touchAction: "pan-x" }}>
                {hist.map((it) => (
                  <div key={it.id} className="img-preview" style={{ margin: 0, position: "relative", flex: "0 0 auto" }}>
                    <img src={`data:${it.mediaType};base64,${it.data}`} alt={it.prompt || "przeróbka"} title={it.prompt || ""} style={{ height: 76, borderRadius: 8, cursor: "pointer" }} onClick={() => loadFromHistory(it)} />
                    <button className="img-x" onClick={() => delHist(it.id)}>✕</button>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 11, marginTop: 2 }}>Dotknij miniaturę, by wziąć ją do dalszej edycji. Przechowywane: ostatnie 16.</p>
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
