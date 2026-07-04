// Web Worker: lokalne embeddingi przez Transformers.js (WebGPU → fallback WASM).
// Transformers.js ładowany DYNAMICZNIE wewnątrz workera — nie wchodzi do głównego bundla,
// pobierany dopiero przy pierwszym użyciu funkcji on-device. Wagi modelu cache'uje sam
// Transformers.js (Cache API/IndexedDB) po pierwszym pobraniu.
//
// Protokół (main → worker):
//   { type: "embed", id, texts, model, device }   → liczy wektory
// (worker → main):
//   { type: "progress", pct, file }               → postęp pobierania wag
//   { type: "ready" }                             → pipeline gotowy (warmup done)
//   { type: "result", id, vectors }               → wektory (number[][])
//   { type: "error", id?, message }               → błąd (caller spada do chmury)

// Transformers.js ładowany z CDN (ESM) zamiast z bundla: biblioteka używa literałów BigInt,
// których niski target buildu (es2019/safari13, dla zgodności starych WebView) nie skompiluje.
// CDN serwuje nowoczesny build; wagi modelu i tak pochodzą z huba i są cache'owane w przeglądarce.
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

let extractorPromise: Promise<any> | null = null;
let loadedModel = "";

async function getExtractor(model: string, device: "webgpu" | "wasm"): Promise<any> {
  if (extractorPromise && loadedModel === model) return extractorPromise;
  loadedModel = model;
  extractorPromise = (async () => {
    const tf: any = await import(/* @vite-ignore */ TRANSFORMERS_CDN);
    const { pipeline, env } = tf;
    // Pozwól pobierać wagi z huba; cache w przeglądarce zostaje włączony domyślnie.
    if (env?.backends?.onnx?.wasm) env.backends.onnx.wasm.proxy = false;
    const extractor = await pipeline("feature-extraction", model, {
      device,
      progress_callback: (p: any) => {
        if (p?.status === "progress" && typeof p.progress === "number") {
          (self as any).postMessage({ type: "progress", pct: Math.round(p.progress), file: p.file });
        }
      },
    });
    (self as any).postMessage({ type: "ready" });
    return extractor;
  })();
  return extractorPromise;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data || {};
  if (msg.type !== "embed") return;
  const { id, texts, model, device } = msg;
  try {
    const extractor = await getExtractor(model, device || "wasm");
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    // out.tolist() → number[][] (jedna lista na tekst).
    const vectors: number[][] = typeof out.tolist === "function" ? out.tolist() : out;
    (self as any).postMessage({ type: "result", id, vectors });
  } catch (err) {
    (self as any).postMessage({ type: "error", id, message: String(err) });
  }
};
