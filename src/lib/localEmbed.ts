// Lokalne embeddingi (on-device) przez Transformers.js w Web Workerze.
// PROJEKT: opcja z capability-check + cichy fallback do chmury. Cała inferencja w workerze
// (nigdy na main thread). Wagi cache'owane przez Transformers.js po pierwszym pobraniu.
//
// Model: wielojęzyczny (PL-first), symetryczny (bez asymetrii query/passage), 384-wymiarowy.
// Tag modelu jedzie z każdym wektorem (MemoryFact.embModel) — porównujemy tylko wektory z
// tego samego modelu (inaczej wymiary się nie zgadzają: chmura Gemini=768 vs lokal=384).

export const LOCAL_EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const LOCAL_EMBED_TAG = "local:mml12";
export const LOCAL_EMBED_DIM = 384;

/** Czy dostępne WebGPU (szybka ścieżka). Brak → fallback do WASM (wolniej, ale działa). */
export function webgpuAvailable(): boolean {
  try {
    return typeof navigator !== "undefined" && !!(navigator as unknown as { gpu?: unknown }).gpu;
  } catch {
    return false;
  }
}

/** Czy w ogóle możemy liczyć lokalnie (potrzebny Web Worker). */
export function localEmbedSupported(): boolean {
  return typeof Worker !== "undefined";
}

/** Czy lokalny embedder jest użyteczny (wspierany i nie zaliczył twardego błędu w tej sesji). */
export function localEmbedUsable(): boolean {
  return localEmbedSupported() && !everFailed;
}

function pickDevice(): "webgpu" | "wasm" {
  return webgpuAvailable() ? "webgpu" : "wasm";
}

// --- Worker (leniwie tworzony, pojedynczy) ---

interface WorkerLike {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

// Fabryka workera — nadpisywalna w testach (w node nie ma web-Workera).
let workerFactory: (() => WorkerLike) | null = null;
export function __setEmbedWorkerFactory(f: (() => WorkerLike) | null): void {
  workerFactory = f;
  worker = null; // wymuś ponowne utworzenie
}

let worker: WorkerLike | null = null;
let reqId = 0;
const pending = new Map<number, { resolve: (v: number[][] | null) => void }>();

type ProgressCb = (pct: number, file?: string) => void;
const progressCbs = new Set<ProgressCb>();
let ready = false;
let everFailed = false;

/** Subskrypcja postępu pobierania wag (UI). Zwraca funkcję odsubskrybowania. */
export function onEmbedProgress(cb: ProgressCb): () => void {
  progressCbs.add(cb);
  return () => progressCbs.delete(cb);
}

/** Czy pipeline jest już rozgrzany (model pobrany i gotowy). */
export function localEmbedReady(): boolean {
  return ready;
}

function defaultFactory(): WorkerLike {
  // Vite zbuduje worker jako osobny chunk; Transformers.js ładuje się dynamicznie w środku.
  return new Worker(new URL("../workers/embedWorker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
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
      progressCbs.forEach((cb) => cb(msg.pct, msg.file));
    } else if (msg.type === "ready") {
      ready = true;
    } else if (msg.type === "result") {
      pending.get(msg.id)?.resolve(Array.isArray(msg.vectors) ? msg.vectors : null);
      pending.delete(msg.id);
    } else if (msg.type === "error") {
      everFailed = true;
      pending.get(msg.id)?.resolve(null);
      pending.delete(msg.id);
    }
  };
  worker.onerror = () => {
    everFailed = true;
    pending.forEach((p) => p.resolve(null));
    pending.clear();
  };
  return worker;
}

/**
 * Policz wektory lokalnie. Zwraca null przy braku wsparcia/błędzie/timeout — wtedy
 * caller (memory.ts) płynnie wraca do chmury. Pierwsze wywołanie pobiera wagi (może potrwać).
 */
export function embedLocal(texts: string[], timeoutMs = 60000): Promise<number[][] | null> {
  if (everFailed || !localEmbedSupported() || !texts.length) return Promise.resolve(null);
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++reqId;
  return new Promise<number[][] | null>((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(null); // za długo (np. wolne pobieranie) — fallback do chmury, ale nie blokuj
      }
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
    });
    w.postMessage({ type: "embed", id, texts, model: LOCAL_EMBED_MODEL, device: pickDevice() });
  });
}

// Tylko do testów — reset stanu modułu.
export function __resetLocalEmbedForTests(): void {
  worker = null;
  pending.clear();
  ready = false;
  everFailed = false;
  reqId = 0;
}
