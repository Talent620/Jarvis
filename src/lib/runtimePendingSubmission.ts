import { normalizeRuntimeUrl, RuntimeHttpError, runtimeRequest, type RuntimeConnection, type RuntimeJob, type RuntimeProfile, type RuntimeStatus } from "./localRuntimeClient";

export interface RuntimeSubmissionScope { url: string; serverId: string }
export interface RuntimePendingSubmission extends RuntimeSubmissionScope {
  version: 1;
  prompt: string;
  idempotencyKey: string;
  createdAt: number;
}
export interface RuntimeOtherPendingSubmission { scope: RuntimeSubmissionScope; idempotencyKey: string; pending: RuntimePendingSubmission | null }
export class RuntimePendingRecordError extends Error {
  constructor(message: string, public readonly idempotencyKey: string) { super(message); this.name = "RuntimePendingRecordError"; }
}
type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;
const STORAGE_PREFIX = "jarvis.runtime.pending.v1:";
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
const flights = new Map<string, { key: string; promise: Promise<RuntimeJob> }>();

export function runtimeSubmissionScope(url: string, serverId: string): RuntimeSubmissionScope {
  if (typeof serverId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(serverId)) throw new Error("Serwer nie podał prawidłowej tożsamości. Odśwież połączenie przed wysłaniem zadania.");
  return { url: normalizeRuntimeUrl(url), serverId };
}

export function runtimePendingStorageKey(scope: RuntimeSubmissionScope, idempotencyKey?: string): string {
  const normalized = runtimeSubmissionScope(scope.url, scope.serverId);
  if (idempotencyKey && idempotencyKey !== "legacy" && !KEY_PATTERN.test(idempotencyKey)) throw new Error("Nieprawidłowy identyfikator lokalnego zgłoszenia.");
  return `${STORAGE_PREFIX}${encodeURIComponent(normalized.url)}:${normalized.serverId}${idempotencyKey && idempotencyKey !== "legacy" ? `:${idempotencyKey}` : ""}`;
}

function readRecord(scope: RuntimeSubmissionScope, idempotencyKey: string, storage: PendingStorage): RuntimePendingSubmission | null {
  let raw: string | null;
  try { raw = storage.getItem(runtimePendingStorageKey(scope, idempotencyKey)); }
  catch { throw new RuntimePendingRecordError("Nie można odczytać lokalnego zapisu zgłoszenia. Wysyłanie jest wstrzymane, aby nie powielić zadania.", idempotencyKey); }
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as RuntimePendingSubmission;
    if (value.version !== 1 || value.url !== normalizeRuntimeUrl(scope.url) || value.serverId !== scope.serverId
      || typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > 16_000
      || typeof value.idempotencyKey !== "string" || !KEY_PATTERN.test(value.idempotencyKey)
      || (idempotencyKey !== "legacy" && value.idempotencyKey !== idempotencyKey)
      || !Number.isFinite(value.createdAt) || value.createdAt <= 0) throw new Error("invalid");
    return { version: 1, url: value.url, serverId: value.serverId, prompt: value.prompt, idempotencyKey: value.idempotencyKey, createdAt: value.createdAt };
  } catch { throw new RuntimePendingRecordError("Lokalny zapis niepotwierdzonego zgłoszenia jest uszkodzony. Nie wysłano nowego zadania. Zachowaj dane aplikacji i sprawdź historię serwera przed ich naprawą.", idempotencyKey); }
}

function blockLegacyRecord(scope: RuntimeSubmissionScope, storage: PendingStorage): void {
  if (readRecord(scope, "legacy", storage)) {
    throw new RuntimePendingRecordError("Znaleziono wcześniejszy wspólny zapis zgłoszenia. Wysyłanie jest wstrzymane. Zamknij starsze okna aplikacji, sprawdź historię serwera i dopiero potem świadomie usuń tę lokalną kopię. Nie została skopiowana ani wysłana ponownie.", "legacy");
  }
}

/** Each immutable intent has its own key, so a late acknowledgement cannot delete another tab's intent. */
export function loadPendingRuntimeSubmission(scope: RuntimeSubmissionScope, storage: PendingStorage = localStorage): RuntimePendingSubmission | null {
  blockLegacyRecord(scope, storage);
  const prefix = `${runtimePendingStorageKey(scope)}:`;
  const records: RuntimePendingSubmission[] = [];
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (!key?.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (!KEY_PATTERN.test(id)) continue;
      const record = readRecord(scope, id, storage);
      if (record) records.push(record);
    }
  } catch (error) {
    if (error instanceof RuntimePendingRecordError) throw error;
    throw new Error("Nie można odczytać lokalnych zgłoszeń. Wysyłanie jest wstrzymane.");
  }
  return records.sort((a, b) => a.createdAt - b.createdAt || a.idempotencyKey.localeCompare(b.idempotencyKey))[0] ?? null;
}

export function preparePendingRuntimeSubmission(scope: RuntimeSubmissionScope, prompt: string, storage: PendingStorage = localStorage): RuntimePendingSubmission {
  if (!prompt.trim() || prompt.length > 16_000) throw new Error("Polecenie musi zawierać od 1 do 16 000 znaków.");
  // Match the server's existing canonicalization once, before persisting and sending.
  const submittedPrompt = prompt.trim();
  const existing = loadPendingRuntimeSubmission(scope, storage);
  if (existing) {
    if (existing.prompt !== submittedPrompt) throw new Error("Najpierw sprawdź przyjęcie poprzedniego zgłoszenia. Jego polecenie i identyfikator pozostają zachowane.");
    return existing;
  }
  const normalized = runtimeSubmissionScope(scope.url, scope.serverId);
  const pending: RuntimePendingSubmission = {
    version: 1, ...normalized, prompt: submittedPrompt, createdAt: Date.now(),
    idempotencyKey: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join(""),
  };
  try {
    const raw = JSON.stringify(pending);
    storage.setItem(runtimePendingStorageKey(scope, pending.idempotencyKey), raw);
    if (storage.getItem(runtimePendingStorageKey(scope, pending.idempotencyKey)) !== raw) throw new Error("write not retained");
  } catch { throw new Error("Nie udało się trwale zapisać zgłoszenia na tym urządzeniu. Nic nie wysłano. Przywróć dostęp do pamięci aplikacji i spróbuj ponownie."); }
  return pending;
}

function assertStored(scope: RuntimeSubmissionScope, pending: RuntimePendingSubmission, storage: PendingStorage): void {
  const saved = readRecord(scope, pending.idempotencyKey, storage);
  if (pending.url !== normalizeRuntimeUrl(scope.url) || pending.serverId !== scope.serverId || !saved || saved.idempotencyKey !== pending.idempotencyKey || saved.prompt !== pending.prompt) {
    throw new Error("Lokalne zgłoszenie zmieniło się lub nie jest już zapisane. Odśwież jego stan przed dalszą operacją.");
  }
}

export function confirmPendingRuntimeSubmission(scope: RuntimeSubmissionScope, pending: RuntimePendingSubmission, job: RuntimeJob, storage: PendingStorage = localStorage): void {
  if (pending.url !== normalizeRuntimeUrl(scope.url) || pending.serverId !== scope.serverId || !job || typeof job.id !== "string" || !job.id || job.idempotencyKey !== pending.idempotencyKey || job.prompt !== pending.prompt) {
    throw new Error("Odpowiedź serwera nie potwierdza tego samego polecenia i identyfikatora. Lokalny zapis pozostaje zachowany.");
  }
  // Another tab may already have cleared this same acknowledged intent.
  if (readRecord(scope, pending.idempotencyKey, storage) === null) return;
  assertStored(scope, pending, storage);
  try {
    storage.removeItem(runtimePendingStorageKey(scope, pending.idempotencyKey));
    if (storage.getItem(runtimePendingStorageKey(scope, pending.idempotencyKey)) !== null) throw new Error("not removed");
  } catch { throw new Error("Serwer potwierdził przyjęcie zadania, ale nie udało się usunąć jego tymczasowej kopii z urządzenia. Sprawdź przyjęcie ponownie po przywróceniu dostępu do pamięci aplikacji."); }
}

async function verifyServer(connection: RuntimeConnection, scope: RuntimeSubmissionScope, signal?: AbortSignal): Promise<RuntimeStatus> {
  if (normalizeRuntimeUrl(connection.url) !== scope.url) throw new Error("Zgłoszenie należy do innego adresu serwera. Nie zostało wysłane.");
  const status = await runtimeRequest<RuntimeStatus>(connection, "/v1/status", { signal });
  if (status.serverId !== scope.serverId) throw new Error("Pod tym adresem działa inny serwer. Poprzednie zgłoszenie pozostaje przypisane do pierwotnego serwera i nie zostało ponowione.");
  if (!status.readiness || !status.queue) throw new Error("Nie można potwierdzić bieżącego stanu serwera.");
  return status;
}

/** Read-only recovery: opening the panel never creates or retries a job. */
export async function reconcilePendingRuntimeSubmission(connection: RuntimeConnection, scope: RuntimeSubmissionScope, pending: RuntimePendingSubmission, options: { signal?: AbortSignal; storage?: PendingStorage } = {}): Promise<RuntimeJob | null> {
  const storage = options.storage ?? localStorage;
  assertStored(scope, pending, storage);
  const status = await verifyServer(connection, scope, options.signal);
  if (!status.capabilities?.requestLookup) throw new Error("Ta wersja serwera nie obsługuje sprawdzania zgłoszenia po identyfikatorze. Nie oznacza to, że zadanie nie zostało przyjęte. Zaktualizuj usługę; lokalny zapis pozostaje zachowany.");
  try {
    const { job } = await runtimeRequest<{ job: RuntimeJob }>(connection, `/v1/jobs/request/${pending.idempotencyKey}`, { signal: options.signal });
    confirmPendingRuntimeSubmission(scope, pending, job, storage);
    return job;
  } catch (error) {
    if (error instanceof RuntimeHttpError && error.status === 404 && error.code === "JOB_NOT_FOUND") return null;
    throw error;
  }
}

/** Reuses the durable key after a lost acknowledgement; identity is checked again at the server's enqueue boundary. */
export function submitPendingRuntimeJob(connection: RuntimeConnection, scope: RuntimeSubmissionScope, pending: RuntimePendingSubmission, options: { signal?: AbortSignal; storage?: PendingStorage } = {}): Promise<RuntimeJob> {
  const flightKey = runtimePendingStorageKey(scope);
  const existing = flights.get(flightKey);
  if (existing) return existing.key === pending.idempotencyKey ? existing.promise : Promise.reject(new Error("Trwa już wysyłanie innego zgłoszenia do tej instancji serwera."));
  const operation = (async () => {
    const storage = options.storage ?? localStorage;
    assertStored(scope, pending, storage);
    const status = await verifyServer(connection, scope, options.signal);
    if (!status.capabilities?.serverIdentityGuard) throw new Error("Zaktualizuj lokalną usługę przed wysłaniem. Ta wersja serwera nie potwierdza tożsamości przy przyjmowaniu zgłoszenia.");
    const profile = await runtimeRequest<RuntimeProfile>(connection, "/v1/profile", { signal: options.signal });
    if (status.readiness.state === "SETUP" || !profile.active?.model) throw new Error("Najpierw skonfiguruj model serwera. Zgłoszenie pozostaje zapisane i nie zostało wysłane.");
    assertStored(scope, pending, storage);
    const { job } = await runtimeRequest<{ job: RuntimeJob }>(connection, "/v1/jobs", { method: "POST", body: { prompt: pending.prompt, idempotencyKey: pending.idempotencyKey, expectedServerId: scope.serverId }, signal: options.signal });
    confirmPendingRuntimeSubmission(scope, pending, job, storage);
    return job;
  })().finally(() => { flights.delete(flightKey); });
  flights.set(flightKey, { key: pending.idempotencyKey, promise: operation });
  return operation;
}

/** Explicit user choice only: deleting this copy never cancels a server job. */
export function forgetPendingRuntimeSubmission(scope: RuntimeSubmissionScope, idempotencyKey: string, storage: PendingStorage = localStorage): void {
  try {
    const exactKey = runtimePendingStorageKey(scope, idempotencyKey);
    storage.removeItem(exactKey);
    if (storage.getItem(exactKey) !== null) throw new Error("not removed");
  } catch { throw new Error("Nie udało się usunąć lokalnej kopii zgłoszenia. Nie zmieniono zadania na serwerze."); }
}

/** A replacement service at the same URL must not silently strand private prompt copies. */
export function otherRuntimePendingSubmissions(scope: RuntimeSubmissionScope, storage: PendingStorage = localStorage): RuntimeOtherPendingSubmission[] {
  const normalized = runtimeSubmissionScope(scope.url, scope.serverId);
  const prefix = `${STORAGE_PREFIX}${encodeURIComponent(normalized.url)}:`;
  const others: RuntimeOtherPendingSubmission[] = [];
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (!key?.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length); const separator = suffix.indexOf(":");
      const serverId = separator < 0 ? suffix : suffix.slice(0, separator);
      const idempotencyKey = separator < 0 ? "legacy" : suffix.slice(separator + 1);
      if (serverId === normalized.serverId || !/^[A-Za-z0-9_-]{1,128}$/.test(serverId) || (idempotencyKey !== "legacy" && !KEY_PATTERN.test(idempotencyKey))) continue;
      const previousScope = runtimeSubmissionScope(normalized.url, serverId);
      try { others.push({ scope: previousScope, idempotencyKey, pending: readRecord(previousScope, idempotencyKey, storage) }); }
      catch { others.push({ scope: previousScope, idempotencyKey, pending: null }); }
    }
  } catch { throw new Error("Nie można odczytać lokalnych kopii zgłoszeń poprzednich instancji serwera."); }
  return others;
}
