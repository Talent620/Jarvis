export interface RuntimeConnection { url: string; token: string }
export interface RuntimeReadiness {
  state: "SETUP" | "READY" | "DEGRADED" | "NEEDS_ACTION";
  checkedAt: string | null;
  expiresAt: string | null;
  reason: string;
  inProgress?: boolean;
}
export interface RuntimeStatus {
  name: string;
  version: string;
  serverId: string;
  profileVersion: number;
  policy: string;
  readiness: RuntimeReadiness;
  queue: { queued: number; running: number; completed: number; failed: number; cancelled: number };
  capabilities: { localAnalysis: boolean; coding: boolean; voice: boolean; processSandbox: boolean; archivedResults?: boolean; requestLookup?: boolean; serverIdentityGuard?: boolean };
}
export interface RuntimeProfile {
  requested: { version: number; policy: string; ollamaUrl: string; model: string };
  active: { version: number; policy: string; ollamaUrl: string; model: string };
  readiness: RuntimeReadiness;
}
export interface RuntimeJob {
  id: string;
  prompt: string;
  idempotencyKey: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  attempt: number;
  model?: string;
  profileVersion?: number;
  result?: string;
  error?: string;
}
export interface RuntimeModel { name: string }
export interface RuntimeArchivedJob {
  id: string;
  idempotencyKey: string;
  status: RuntimeJob["status"];
  createdAt: string;
  updatedAt: string;
  attempt: number;
  model?: string;
  profileVersion?: number;
  promptPreview: string;
  hasResult: boolean;
  hasError: boolean;
}
export interface RuntimeArchivePage { jobs: RuntimeArchivedJob[]; nextCursor: string | null; total: number }

export class RuntimeHttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message); this.name = "RuntimeHttpError";
  }
}

const CONNECTION_KEY = "jarvis.local-runtime.connection.v1";
export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:3211";

export function normalizeRuntimeUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("Podaj pełny adres serwera, np. http://127.0.0.1:3211."); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Połączenie poza tym komputerem wymaga adresu HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("Adres serwera nie może zawierać hasła, ścieżki ani parametrów.");
  }
  return url.origin;
}

export function loadRuntimeConnection(): RuntimeConnection | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CONNECTION_KEY) || "null") as Partial<RuntimeConnection> | null;
    if (!saved || typeof saved.url !== "string" || typeof saved.token !== "string" || !saved.token.trim()) return null;
    return { url: normalizeRuntimeUrl(saved.url), token: saved.token.trim() };
  } catch { return null; }
}

export function saveRuntimeConnection(connection: RuntimeConnection): RuntimeConnection {
  const normalized = { url: normalizeRuntimeUrl(connection.url), token: connection.token.trim() };
  if (!normalized.token || /[\r\n]/.test(normalized.token)) throw new Error("Wpisz prawidłowy token dostępu do serwera.");
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(normalized));
  return normalized;
}

export function forgetRuntimeConnection(): void { localStorage.removeItem(CONNECTION_KEY); }

export function requestRuntimeStart(start: () => Promise<{ ok: boolean; error?: string }>, options: {
  signal?: AbortSignal; timeoutMs?: number;
} = {}): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort); resolve(result);
    };
    const abort = () => finish({ ok: false });
    const timer = setTimeout(() => finish({ ok: false, error: "Uruchamianie trwa dłużej niż oczekiwano. Sprawdź usługę i ponów połączenie." }), options.timeoutMs ?? 60_000);
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener("abort", abort, { once: true });
    void Promise.resolve().then(start).then(finish, () => finish({ ok: false, error: "Nie udało się uruchomić lokalnej usługi. Spróbuj ponownie." }));
  });
}

/** A connection file can outlive its service. Wait for authenticated HTTP, without claiming model readiness. */
export async function waitForRuntimeConnection(readConnection: () => Promise<RuntimeConnection | null>, options: {
  signal?: AbortSignal; timeoutMs?: number; intervalMs?: number;
} = {}): Promise<RuntimeConnection | null> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  const timeout = setTimeout(abort, Math.max(0, deadline - Date.now()));
  if (options.signal?.aborted) lifetime.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  try { while (!lifetime.signal.aborted && Date.now() < deadline) {
    try {
      // Bound the bridge call itself: a stalled main process must not leave the panel busy forever.
      const found = await new Promise<RuntimeConnection | null>((resolve) => {
        const cancelled = () => { lifetime.signal.removeEventListener("abort", cancelled); resolve(null); };
        lifetime.signal.addEventListener("abort", cancelled, { once: true });
        void Promise.resolve().then(readConnection).then((value) => {
          lifetime.signal.removeEventListener("abort", cancelled); resolve(value);
        }, cancelled);
      });
      if (lifetime.signal.aborted) return null;
      if (found?.token?.trim()) {
        const connection = { url: normalizeRuntimeUrl(found.url), token: found.token.trim() };
        const status = await runtimeRequest<RuntimeStatus>(connection, "/v1/status", {
          signal: lifetime.signal, timeoutMs: Math.max(1, Math.min(1000, deadline - Date.now())),
        });
        if (!lifetime.signal.aborted && status.readiness && status.queue) return connection;
      }
    } catch { /* Service startup and stale connection files are expected during discovery. */ }
    const delay = Math.min(options.intervalMs ?? 700, deadline - Date.now());
    if (lifetime.signal.aborted || delay <= 0) return null;
    await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); lifetime.signal.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, delay);
      lifetime.signal.addEventListener("abort", finish, { once: true });
    });
  }
  return null;
  } finally { clearTimeout(timeout); options.signal?.removeEventListener("abort", abort); }
}

export function displayedRuntimeState(readiness: RuntimeReadiness | undefined, online: boolean, now = Date.now()): string {
  if (!online) return "OFFLINE";
  if (!readiness) return "UNKNOWN";
  if (readiness.state === "READY") {
    const expires = readiness.expiresAt ? Date.parse(readiness.expiresAt) : NaN;
    const checked = readiness.checkedAt ? Date.parse(readiness.checkedAt) : NaN;
    if (!Number.isFinite(expires) || !Number.isFinite(checked) || expires <= now || checked > now + 60_000) return "DEGRADED";
  }
  return readiness.state;
}

/** This client only communicates with the selected service; HTTP success is not model readiness. */
export async function runtimeRequest<T>(connection: RuntimeConnection, path: string, options: {
  method?: "GET" | "POST" | "PUT"; body?: unknown; signal?: AbortSignal; timeoutMs?: number; query?: Record<string, string | number>;
} = {}): Promise<T> {
  const base = normalizeRuntimeUrl(connection.url);
  if (!/^\/v1\/[a-zA-Z0-9/_.:-]+$/.test(path) || path.split("/").some(segment => segment === "." || segment === "..")) throw new Error("Nieprawidłowa operacja serwera.");
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 15_000);
  try {
    const query = new URLSearchParams(Object.entries(options.query || {}).map(([key, value]) => [key, String(value)]));
    const response = await fetch(`${base}${path}${query.size ? `?${query}` : ""}`, {
      method: options.method || "GET", signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${connection.token}`, ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = typeof data?.error?.code === "string" ? data.error.code : "HTTP_ERROR";
      if (response.status === 401 || response.status === 403) throw new RuntimeHttpError("Serwer odmówił dostępu. Sprawdź token i dozwolone połączenia w konfiguracji usługi.", response.status, code);
      const message = typeof data?.error?.message === "string" ? data.error.message : `Serwer zwrócił błąd ${response.status}.`;
      throw new RuntimeHttpError(connection.token ? message.split(connection.token).join("[ukryto token]") : message, response.status, code);
    }
    if (!data || typeof data !== "object") throw new Error("Serwer zwrócił nieprawidłową odpowiedź.");
    return data as T;
  } catch (error) {
    if (timedOut) throw new Error("Serwer nie odpowiedział w czasie. Sprawdź stan zadania przed ponowieniem; mogło zostać przyjęte.");
    if (error instanceof TypeError) throw new Error("Nie mogę połączyć się z serwerem. Sprawdź, czy usługa działa i czy adres jest prawidłowy.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
