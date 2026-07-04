// Web Worker: mózg on-device przez WebLLM (MLC) na WebGPU. Cała inferencja w workerze.
// WebLLM ładowany z CDN (ESM) — biblioteka jest duża i nowoczesna; nie wciągamy jej do
// głównego bundla. Wagi modelu (INT4) cache'owane przez WebLLM w Cache API/IndexedDB.
//
// Protokół (main → worker):
//   { type: "chat", id, model, messages, temperature }
// (worker → main):
//   { type: "progress", text, pct }   → postęp pobierania/ładowania wag
//   { type: "ready", model }          → model gotowy
//   { type: "result", id, text }      → odpowiedź
//   { type: "error", id?, message }

const WEBLLM_CDN = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm";

let enginePromise: Promise<any> | null = null;
let loadedModel = "";

async function getEngine(model: string): Promise<any> {
  if (enginePromise && loadedModel === model) return enginePromise;
  loadedModel = model;
  enginePromise = (async () => {
    const webllm: any = await import(/* @vite-ignore */ WEBLLM_CDN);
    const engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (p: any) => {
        (self as any).postMessage({
          type: "progress",
          text: p?.text || "",
          pct: typeof p?.progress === "number" ? Math.round(p.progress * 100) : 0,
        });
      },
    });
    (self as any).postMessage({ type: "ready", model });
    return engine;
  })();
  return enginePromise;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data || {};
  if (msg.type !== "chat") return;
  const { id, model, messages, temperature } = msg;
  try {
    const engine = await getEngine(model);
    const res = await engine.chat.completions.create({
      messages,
      temperature: typeof temperature === "number" ? temperature : 0.7,
      stream: false,
    });
    const text = res?.choices?.[0]?.message?.content || "";
    (self as any).postMessage({ type: "result", id, text });
  } catch (err) {
    enginePromise = null; // pozwól spróbować ponownie po błędzie
    loadedModel = "";
    (self as any).postMessage({ type: "error", id, message: String(err) });
  }
};
