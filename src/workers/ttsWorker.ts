// Web Worker: synteza mowy on-device (Kokoro przez kokoro-js, WASM/WebGPU). Z CDN (jak reszta
// warstwy on-device). Wyjście: bajty WAV (transferowalny ArrayBuffer) odtwarzane na main thread.
//
// Protokół: { type:"tts", id, text, voice, model, device } → { type:"result", id, wav:ArrayBuffer }
//           { type:"progress", pct } | { type:"ready" } | { type:"error", id?, message }

const KOKORO_CDN = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.0/+esm";

let ttsPromise: Promise<any> | null = null;
let loadedModel = "";

async function getTts(model: string, device: "webgpu" | "wasm"): Promise<any> {
  if (ttsPromise && loadedModel === model) return ttsPromise;
  loadedModel = model;
  ttsPromise = (async () => {
    const mod: any = await import(/* @vite-ignore */ KOKORO_CDN);
    const KokoroTTS = mod.KokoroTTS || mod.default?.KokoroTTS;
    const tts = await KokoroTTS.from_pretrained(model, {
      dtype: device === "webgpu" ? "fp32" : "q8",
      device,
      progress_callback: (p: any) => {
        if (p?.status === "progress" && typeof p.progress === "number") {
          (self as any).postMessage({ type: "progress", pct: Math.round(p.progress) });
        }
      },
    });
    (self as any).postMessage({ type: "ready" });
    return tts;
  })();
  return ttsPromise;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data || {};
  if (msg.type !== "tts") return;
  const { id, text, voice, model, device } = msg;
  try {
    const tts = await getTts(model, device || "wasm");
    const audio = await tts.generate(text, { voice: voice || "af_heart" });
    const wav: ArrayBuffer = audio.toWav();
    (self as any).postMessage({ type: "result", id, wav }, [wav]);
  } catch (err) {
    ttsPromise = null;
    loadedModel = "";
    (self as any).postMessage({ type: "error", id, message: String(err) });
  }
};
