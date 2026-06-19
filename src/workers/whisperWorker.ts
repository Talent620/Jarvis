// Web Worker: rozpoznawanie mowy on-device (Whisper przez Transformers.js, WebGPU→WASM).
// Transformers.js z CDN (jak embeddingi). Wejście: PCM Float32 @16 kHz (zdekodowane na main
// thread, bo workery nie mają AudioContext). Wyjście: tekst transkrypcji.
//
// Protokół: { type:"stt", id, audio:Float32Array, lang, model, device } → { type:"result", id, text }
//           { type:"progress", pct } | { type:"ready" } | { type:"error", id?, message }

const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

let asrPromise: Promise<any> | null = null;
let loadedModel = "";

async function getAsr(model: string, device: "webgpu" | "wasm"): Promise<any> {
  if (asrPromise && loadedModel === model) return asrPromise;
  loadedModel = model;
  asrPromise = (async () => {
    const tf: any = await import(/* @vite-ignore */ TRANSFORMERS_CDN);
    const asr = await tf.pipeline("automatic-speech-recognition", model, {
      device,
      progress_callback: (p: any) => {
        if (p?.status === "progress" && typeof p.progress === "number") {
          (self as any).postMessage({ type: "progress", pct: Math.round(p.progress) });
        }
      },
    });
    (self as any).postMessage({ type: "ready" });
    return asr;
  })();
  return asrPromise;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data || {};
  if (msg.type !== "stt") return;
  const { id, audio, lang, model, device } = msg;
  try {
    const asr = await getAsr(model, device || "wasm");
    const out = await asr(audio, {
      language: lang || "polish",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = (Array.isArray(out) ? out.map((o: any) => o.text).join(" ") : out?.text) || "";
    (self as any).postMessage({ type: "result", id, text });
  } catch (err) {
    asrPromise = null;
    loadedModel = "";
    (self as any).postMessage({ type: "error", id, message: String(err) });
  }
};
