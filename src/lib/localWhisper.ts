// Rozpoznawanie mowy on-device (Whisper) — zarządzanie Web Workerem + dekodowanie audio.
// OPCJA z capability-check + fallback do chmury (Groq). Dekodowanie Blob→PCM16k robimy na
// main thread (workery nie mają AudioContext), inferencję w workerze. Wagi cache'owane.

import { webgpuAvailable } from "./localEmbed";

// Whisper-base: dobry kompromis jakość/rozmiar (~145 MB), wspiera polski. „tiny" = szybszy.
export const WHISPER_MODEL = "Xenova/whisper-base";
export const WHISPER_MODEL_TAG = "local:whisper-base";

/** Czy STT on-device jest możliwe (Web Worker + dekodowanie audio na main thread). */
export function localSttSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof OfflineAudioContext !== "undefined"
  );
}

function pickDevice(): "webgpu" | "wasm" {
  return webgpuAvailable() ? "webgpu" : "wasm";
}

/** Zdekoduj dowolny Blob audio do mono PCM Float32 @16 kHz (format wymagany przez Whisper). */
export async function decodeTo16kMono(blob: Blob): Promise<Float32Array | null> {
  try {
    const buf = await blob.arrayBuffer();
    const ac = new AudioContext();
    const decoded = await ac.decodeAudioData(buf);
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    try { void ac.close(); } catch { /* ignore */ }
    return rendered.getChannelData(0).slice();
  } catch {
    return null;
  }
}

// --- Worker ---

interface WorkerLike {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

let workerFactory: (() => WorkerLike) | null = null;
export function __setWhisperWorkerFactory(f: (() => WorkerLike) | null): void {
  workerFactory = f;
  worker = null;
}

let worker: WorkerLike | null = null;
let reqId = 0;
const pending = new Map<number, (text: string | null) => void>();
let everFailed = false;

/** Czy STT on-device jest użyteczne (wspierane i bez twardego błędu w tej sesji). */
export function localSttUsable(): boolean {
  return localSttSupported() && !everFailed;
}

function defaultFactory(): WorkerLike {
  return new Worker(new URL("../workers/whisperWorker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
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
      pending.get(msg.id)?.(typeof msg.text === "string" ? msg.text : null);
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
 * Transkrybuj Blob audio lokalnie. Zwraca null przy braku wsparcia/błędzie/timeout —
 * wtedy caller (transcribeAudio) wraca do chmury (Groq).
 */
export async function transcribeLocal(blob: Blob, lang = "polish", timeoutMs = 120000): Promise<string | null> {
  if (everFailed || !localSttSupported()) return null;
  const audio = await decodeTo16kMono(blob);
  if (!audio || !audio.length) return null;
  const w = getWorker();
  if (!w) return null;
  const id = ++reqId;
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); resolve(null); }
    }, timeoutMs);
    pending.set(id, (text) => { clearTimeout(timer); resolve(text); });
    w.postMessage({ type: "stt", id, audio, lang, model: WHISPER_MODEL, device: pickDevice() });
  });
}

export function __resetWhisperForTests(): void {
  worker = null;
  pending.clear();
  everFailed = false;
  reqId = 0;
}
