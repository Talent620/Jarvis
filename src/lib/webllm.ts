// Mózg on-device (WebLLM/MLC) — zarządzanie Web Workerem z głównego wątku.
// OPCJA z capability-check: WebLLM WYMAGA WebGPU (brak fallbacku WASM dla LLM). Bez WebGPU
// provider jest niedostępny i router cicho wraca do chmury. Wagi cache'owane po pobraniu.

import { webgpuAvailable } from "./localEmbed";

export interface WebllmModel {
  id: string;
  label: string;
}

// Katalog modeli on-device (INT4, działają w przeglądarce na WebGPU). Małe = szybszy start.
export const WEBLLM_MODELS: WebllmModel[] = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B — najszybszy (~1.2 GB)" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B — zbalansowany (~2.2 GB)" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen2.5 3B — wielojęzyczny (~2.0 GB)" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 mini — mocny rozsądek (~2.2 GB)" },
];

export const WEBLLM_DEFAULT_MODEL = WEBLLM_MODELS[0].id;

/** Czy mózg on-device jest w ogóle możliwy (Web Worker + WebGPU). */
export function webllmSupported(): boolean {
  return typeof Worker !== "undefined" && webgpuAvailable();
}

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

// --- Worker (leniwie tworzony) ---

interface WorkerLike {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

let workerFactory: (() => WorkerLike) | null = null;
export function __setWebllmWorkerFactory(f: (() => WorkerLike) | null): void {
  workerFactory = f;
  worker = null;
}

let worker: WorkerLike | null = null;
let reqId = 0;
const pending = new Map<number, (text: string | null) => void>();

type ProgressCb = (pct: number, text: string) => void;
const progressCbs = new Set<ProgressCb>();
let ready = false;
let everFailed = false;

export function onWebllmProgress(cb: ProgressCb): () => void {
  progressCbs.add(cb);
  return () => progressCbs.delete(cb);
}

export function webllmReady(): boolean {
  return ready;
}

/** Czy provider on-device jest użyteczny (wspierany i bez twardego błędu w tej sesji). */
export function webllmUsable(): boolean {
  return webllmSupported() && !everFailed;
}

function defaultFactory(): WorkerLike {
  return new Worker(new URL("../workers/webllmWorker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
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
    if (msg.type === "progress") {
      progressCbs.forEach((cb) => cb(msg.pct || 0, msg.text || ""));
    } else if (msg.type === "ready") {
      ready = true;
    } else if (msg.type === "result") {
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
 * Wygeneruj odpowiedź lokalnie. Zwraca null przy braku wsparcia/błędzie/timeout — wtedy
 * caller (provider) rzuca błąd i router spada do chmury. Pierwsze użycie pobiera wagi.
 */
export function chatLocal(model: string, messages: ChatMsg[], opts: { temperature?: number; timeoutMs?: number } = {}): Promise<string | null> {
  if (everFailed || !webllmSupported() || !messages.length) return Promise.resolve(null);
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++reqId;
  const timeoutMs = opts.timeoutMs ?? 180000; // pierwsze pobranie wag bywa długie
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(null);
      }
    }, timeoutMs);
    pending.set(id, (text) => {
      clearTimeout(timer);
      resolve(text);
    });
    w.postMessage({ type: "chat", id, model, messages, temperature: opts.temperature });
  });
}

// Tylko do testów.
export function __resetWebllmForTests(): void {
  worker = null;
  pending.clear();
  ready = false;
  everFailed = false;
  reqId = 0;
}
