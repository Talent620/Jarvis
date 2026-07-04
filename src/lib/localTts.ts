// Synteza mowy on-device (Kokoro) — zarządzanie Web Workerem. OPCJA z capability-check +
// fallback do dotychczasowych głosów (Gemini/system). Zwraca Blob WAV gotowy do odtworzenia.
// UWAGA: Kokoro najlepiej wspiera angielski; dla polskiego jakość bywa ograniczona — dlatego
// to opcja z fallbackiem, nie domyślny silnik.

import { webgpuAvailable } from "./localEmbed";

export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const KOKORO_DEFAULT_VOICE = "af_heart";

export function localTtsSupported(): boolean {
  return typeof Worker !== "undefined";
}

function pickDevice(): "webgpu" | "wasm" {
  return webgpuAvailable() ? "webgpu" : "wasm";
}

interface WorkerLike {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

let workerFactory: (() => WorkerLike) | null = null;
export function __setTtsWorkerFactory(f: (() => WorkerLike) | null): void {
  workerFactory = f;
  worker = null;
}

let worker: WorkerLike | null = null;
let reqId = 0;
const pending = new Map<number, (wav: ArrayBuffer | null) => void>();
let everFailed = false;

export function localTtsUsable(): boolean {
  return localTtsSupported() && !everFailed;
}

function defaultFactory(): WorkerLike {
  return new Worker(new URL("../workers/ttsWorker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}

function getWorker(): WorkerLike | null {
  if (worker) return worker;
  try {
    worker = (workerFactory || defaultFactory)();
  } catch {
    everFailed = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent) => {
    const msg = (e as MessageEvent).data || {};
    if (msg.type === "result") {
      pending.get(msg.id)?.(msg.wav instanceof ArrayBuffer ? msg.wav : null);
      pending.delete(msg.id);
    } else if (msg.type === "error") {
      everFailed = true;
      pending.get(msg.id)?.(null);
      pending.delete(msg.id);
    }
  };
  worker.onerror = () => {
    everFailed = true;
    pending.forEach((res) => res(null));
    pending.clear();
  };
  return worker;
}

/**
 * Zsyntetyzuj mowę lokalnie → Blob WAV. Zwraca null przy braku wsparcia/błędzie/timeout —
 * wtedy caller (speak) wraca do dotychczasowego głosu.
 */
export async function synthLocal(text: string, voice = KOKORO_DEFAULT_VOICE, timeoutMs = 120000): Promise<Blob | null> {
  if (everFailed || !localTtsSupported() || !text.trim()) return null;
  const w = getWorker();
  if (!w) return null;
  const id = ++reqId;
  const wav = await new Promise<ArrayBuffer | null>((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); resolve(null); }
    }, timeoutMs);
    pending.set(id, (w2) => { clearTimeout(timer); resolve(w2); });
    w.postMessage({ type: "tts", id, text, voice, model: KOKORO_MODEL, device: pickDevice() });
  });
  return wav ? new Blob([wav], { type: "audio/wav" }) : null;
}

export function __resetTtsForTests(): void {
  worker = null;
  pending.clear();
  everFailed = false;
  reqId = 0;
}
