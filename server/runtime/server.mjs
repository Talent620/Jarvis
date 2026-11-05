import http from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, unlink, chmod, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const VERSION = '0.1.0';
export const defaultDataDir = () => process.env.JARVIS_RUNTIME_DATA_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'jarvis/runtime');
const now = () => new Date().toISOString();
const terminal = new Set(['completed', 'failed', 'cancelled']);
const MAX_JOBS = 500;
const MAX_PROMPT = 24000;
const MAX_BODY = 128 * 1024;
const MAX_OUTPUT = 200000;
export class RuntimeError extends Error {
  constructor(message, code = 'INVALID_REQUEST', status = 400) { super(message); this.code = code; this.status = status; }
}
export function validateProfile(input = {}) {
  let endpoint;
  try { endpoint = new URL(input.ollamaUrl || 'http://127.0.0.1:11434'); } catch { throw new RuntimeError('Nieprawidłowy adres Ollamy.'); }
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname)) {
    throw new RuntimeError('Runtime obsługuje wyłącznie HTTP Ollamy na adresie loopback tego serwera.');
  }
  if (endpoint.hostname === 'localhost') endpoint.hostname = '127.0.0.1';
  const model = String(input.model || '').trim();
  if (model.length > 160 || (model && !/^[a-zA-Z0-9_.:/-]+$/.test(model))) throw new RuntimeError('Nieprawidłowa nazwa modelu.');
  return { version: Number.isSafeInteger(input.version) && input.version > 0 ? input.version : 1, policy: 'local_only', ollamaUrl: endpoint.origin, model };
}
export async function atomicJson(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(tmp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); await handle.close(); handle = null;
    await rename(tmp, file); await chmod(file, 0o600);
    // Persist the directory entry as well as the file content on supported systems.
    let directory;
    try { directory = await open(path.dirname(file), 'r'); await directory.sync(); } catch { /* unsupported directory fsync */ }
    finally { await directory?.close(); }
  } finally { await handle?.close(); await unlink(tmp).catch(() => {}); }
}
async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new RuntimeError(`Nie można odczytać stanu: ${path.basename(file)}. Zachowano plik do diagnostyki.`, 'CORRUPT_STATE', 503); }
}
async function takeFileLock(lockFile) {
  const identity = randomUUID();
  const take = () => writeFile(lockFile, JSON.stringify({ pid: process.pid, identity }), { flag: 'wx', mode: 0o600 });
  try { await take(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const recoveryDir = lockFile.replace(/\.lock$/, '.recovery');
    try { await mkdir(recoveryDir, { mode: 0o700 }); }
    catch (guard) { if (guard.code !== 'EEXIST') throw guard; throw new RuntimeError(`Trwa odzyskiwanie blokady ${path.basename(lockFile)}. Jeśli problem pozostaje, sprawdź procesy przed usunięciem ${path.basename(recoveryDir)}.`, 'LOCKED', 409); }
    try {
      // Re-read under the exclusive recovery guard; never remove a lock that
      // was observed before a competing process acquired this guard.
      const old = await readJson(lockFile, null);
      if (old) {
        if (!Number.isInteger(old.pid) || old.pid <= 0) throw new RuntimeError('Nieprawidłowa blokada; sprawdź proces przed jej usunięciem.', 'LOCKED', 409);
        try { process.kill(old.pid, 0); throw new RuntimeError(`Runtime już korzysta z blokady ${path.basename(lockFile)}.`, 'LOCKED', 409); }
        catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
        await unlink(lockFile);
      }
      await take();
    } finally { await rmdir(recoveryDir); }
  }
  return async () => { const current = await readJson(lockFile, null); if (current?.identity === identity) await unlink(lockFile).catch(() => {}); };
}
async function withProfileLock(dataDir, action) {
  const deadline = Date.now() + 3000;
  let unlock;
  while (!unlock) {
    try { unlock = await takeFileLock(path.join(dataDir, 'profile.lock')); }
    catch (error) {
      if (!['LOCKED', 'EEXIST'].includes(error.code) || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  try { return await action(); } finally { await unlock(); }
}
function validJob(job) {
  if (!job || typeof job.id !== 'string' || !/^[a-f0-9-]{36}$/.test(job.id) || typeof job.prompt !== 'string' || !job.prompt.trim() || job.prompt.length > MAX_PROMPT || !['queued', 'running', ...terminal].includes(job.status)) return false;
  if (!Number.isSafeInteger(job.attempt) || job.attempt < 0 || !Number.isSafeInteger(job.profileVersion) || job.profileVersion < 1 || job.execution !== 'local-analysis') return false;
  if (typeof job.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(job.idempotencyKey) || typeof job.model !== 'string' || !job.model || typeof job.ollamaUrl !== 'string') return false;
  if (![job.createdAt, job.updatedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) return false;
  if (job.result !== undefined && (typeof job.result !== 'string' || job.result.length > MAX_OUTPUT)) return false;
  if (job.error !== undefined && (typeof job.error !== 'string' || job.error.length > 2000)) return false;
  try { validateProfile({ model: job.model, ollamaUrl: job.ollamaUrl, version: job.profileVersion }); return true; } catch { return false; }
}
export async function configureRuntime(dataDir, patch) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  return withProfileLock(dataDir, async () => {
    const file = path.join(dataDir, 'profile.json');
    const previous = await readJson(file, { version: 0 });
    const profile = validateProfile({ ...previous, ...patch, version: (previous.version || 0) + 1 });
    await atomicJson(file, profile);
    return profile;
  });
}
function hasRemoteMetadata(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => (/^(remote_model|remote_host|cloud|cloud_model|cloud_host)$/i.test(key) && !!item) || (typeof item === 'object' && hasRemoteMetadata(item)));
}
function isLocalChatCandidate(item) {
  return item && typeof item.name === 'string' && item.name.length <= 160 && /^[a-zA-Z0-9_.:/-]+$/.test(item.name)
    && item.details?.format === 'gguf' && !hasRemoteMetadata(item)
    && !/(?:^|[/:._-])(?:cloud|embed(?:ding)?s?|reranker?|nomic-embed|bge|all-minilm)(?:$|[/:._-])/i.test(item.name)
    && (!Array.isArray(item.capabilities) || item.capabilities.includes('completion'));
}
async function boundedJson(response, limit = 2_000_000) {
  const reader = response.body?.getReader();
  if (!reader) throw new RuntimeError('Ollama zwróciła pustą odpowiedź.', 'INVALID_MODEL_RESPONSE', 502);
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new RuntimeError('Odpowiedź modelu przekroczyła limit pamięci.', 'OUTPUT_LIMIT', 502); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof RuntimeError) throw error; throw new RuntimeError('Ollama zwróciła nieprawidłową odpowiedź JSON.', 'INVALID_MODEL_RESPONSE', 502); }
}
export async function createRuntime(options = {}) {
  const dataDir = path.resolve(options.dataDir || defaultDataDir());
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const unlock = await takeFileLock(path.join(dataDir, 'runtime.lock'));
  try {
    const profileFile = path.join(dataDir, 'profile.json');
    let requested;
    if (options.model !== undefined || options.ollamaUrl !== undefined) requested = await configureRuntime(dataDir, { ...(options.model !== undefined ? { model: options.model } : {}), ...(options.ollamaUrl !== undefined ? { ollamaUrl: options.ollamaUrl } : {}) });
    else requested = await withProfileLock(dataDir, async () => {
      const saved = await readJson(profileFile, null);
      const profile = validateProfile(saved || {});
      if (!saved) await atomicJson(profileFile, profile);
      return profile;
    });
    let active = Object.freeze({ ...requested });
    const stateFile = path.join(dataDir, 'state.json');
    let state = await readJson(stateFile, { schemaVersion: 1, serverId: randomUUID(), jobs: [] });
    if (state.schemaVersion !== 1 || typeof state.serverId !== 'string' || !Array.isArray(state.jobs) || state.jobs.length > MAX_JOBS || state.jobs.some(job => !validJob(job)) || new Set(state.jobs.map(job => job.id)).size !== state.jobs.length || new Set(state.jobs.map(job => job.idempotencyKey)).size !== state.jobs.length || (state.archivedCount !== undefined && (!Number.isSafeInteger(state.archivedCount) || state.archivedCount < 0))) throw new RuntimeError('Nieprawidłowy stan kolejki; dane zachowano.', 'CORRUPT_STATE', 503);
    const archiveDir = path.join(dataDir, 'archive');
    await mkdir(archiveDir, { recursive: true, mode: 0o700 });
    const archiveFile = key => path.join(archiveDir, `${createHash('sha256').update(key).digest('hex')}.json`);
    // Only side-effect-free analysis jobs exist in this runtime; interrupted work may retry.
    state.jobs = state.jobs.map(job => job.status === 'running' ? { ...job, status: job.attempt >= 3 ? 'failed' : 'queued', updatedAt: now(), error: job.attempt >= 3 ? 'Przekroczono liczbę wznowień po restarcie.' : undefined } : job);
    await atomicJson(stateFile, state);
    const secretFile = path.join(dataDir, 'token');
    let token;
    try { token = (await readFile(secretFile, 'utf8')).trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; token = randomBytes(32).toString('hex'); await writeFile(secretFile, token, { flag: 'wx', mode: 0o600 }); }
    if (!/^[a-f0-9]{64}$/.test(token)) throw new RuntimeError('Nieprawidłowy token runtime.', 'INVALID_TOKEN', 503);
    await chmod(secretFile, 0o600);
    const autoDiscover = options.autoDiscover !== false;
    const autoProbe = options.autoProbe !== false;
    const lifetimeAbort = new AbortController();
    let startupPromise = null, startupHandle = null, automaticProbe = false;
    let readiness = { state: active.model ? 'NEEDS_ACTION' : 'SETUP', checkedAt: null, expiresAt: null, reason: active.model ? (autoProbe ? 'Przygotowuję rzeczywisty test lokalnego modelu.' : 'Model skonfigurowany; wykonaj rzeczywisty test odpowiedzi.') : (autoDiscover ? 'Sprawdzam automatycznie zainstalowane modele Ollamy.' : 'Wybierz i pobierz lokalny model Ollama.') };
    let mutation = Promise.resolve();
    let stopping = false, worker = null, activeAbort = null, activeJobId = null, probePromise = null;
    const ttl = Math.max(100, options.probeTtlMs ?? 60_000);
    const timeout = Math.max(100, options.inferenceTimeoutMs ?? 120_000);
    const origins = new Set(['null', ...(options.allowedOrigins || [])]);
    const change = (fn) => {
      const operation = mutation.then(async () => { const next = structuredClone(state); const result = await fn(next); await atomicJson(stateFile, next); state = next; return result; });
      mutation = operation.catch(() => {}); return operation;
    };
    const updateReadiness = (ok, reason) => { readiness = { state: ok ? 'READY' : active.model ? 'DEGRADED' : 'SETUP', checkedAt: now(), expiresAt: new Date(Date.now() + ttl).toISOString(), reason }; };
    const modelRequest = async (endpoint, payload, signal, profile = active) => {
      const response = await fetch(`${profile.ollamaUrl}${endpoint}`, { method: payload === undefined ? 'GET' : 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal });
      if (!response.ok) throw new RuntimeError(response.status === 404 ? 'Nie znaleziono lokalnego modelu. Pobierz go w Ollamie.' : `Ollama zgłosiła błąd HTTP ${response.status}.`, 'MODEL_UNAVAILABLE', 502);
      return boundedJson(response);
    };
    const checkModel = async (profile, signal) => {
      if (!profile.model) throw new RuntimeError('Nie wybrano lokalnego modelu.', 'MODEL_NOT_CONFIGURED', 422);
      const metadata = await modelRequest('/api/show', { model: profile.model }, signal, profile);
      if (hasRemoteMetadata(metadata) || /(?:^|[-:])cloud(?:$|[-:])/i.test(profile.model)) throw new RuntimeError('Wybrany model przekazuje wykonanie do chmury. Profil lokalny go odrzuca.', 'REMOTE_MODEL_REJECTED', 422);
      if (metadata.details?.format !== 'gguf' || !(metadata.model_info && Object.keys(metadata.model_info).length)) throw new RuntimeError('Metadane nie potwierdzają lokalnego modelu GGUF. Wybierz sprawdzony model lokalny.', 'UNVERIFIED_LOCAL_MODEL', 422);
      if (Array.isArray(metadata.capabilities) && !metadata.capabilities.includes('completion')) throw new RuntimeError('Wybrany model nie obsługuje generowania odpowiedzi tekstowych.', 'NON_CHAT_MODEL', 422);
      return metadata;
    };
    const infer = async (prompt, signal, profile = active) => {
      await checkModel(profile, signal);
      const reply = await modelRequest('/api/chat', { model: profile.model, stream: false, messages: [{ role: 'system', content: 'Odpowiadaj po polsku. Wykonujesz wyłącznie analizę tekstową. Nie twierdź, że wykonałeś działania w systemie lub narzędziach.' }, { role: 'user', content: prompt }], options: { num_predict: 4096 } }, signal, profile);
      const text = reply.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new RuntimeError('Model nie zwrócił treści odpowiedzi.', 'EMPTY_RESPONSE', 502);
      if (text.length > MAX_OUTPUT) throw new RuntimeError('Odpowiedź przekroczyła limit.', 'OUTPUT_LIMIT', 502);
      return text;
    };
    const publicFailure = (error) => error instanceof RuntimeError ? error.message : error?.name === 'TimeoutError' ? 'Model przekroczył czas odpowiedzi.' : error?.name === 'AbortError' ? 'Przerwano wykonanie.' : 'Nie można połączyć się z lokalną Ollamą. Sprawdź usługę i model.';
    const probe = ({ automatic = false } = {}) => {
      if (stopping) throw new RuntimeError('Runtime jest zamykany.', 'STOPPING', 503);
      if (probePromise) return probePromise;
      if (worker) throw new RuntimeError('Trwa zadanie; test modelu wykonaj po jego zakończeniu.', 'BUSY', 409);
      const controller = new AbortController(); activeAbort = controller;
      automaticProbe = automatic;
      const checkedProfile = active;
      probePromise = (async () => {
        try { await infer('Odpowiedz jednym słowem: OK.', AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(timeout, 30000))]), checkedProfile); if (checkedProfile.version === active.version) updateReadiness(true, 'Model odpowiedział na rzeczywiste żądanie.'); }
        catch (error) {
          if (checkedProfile.version === active.version && !(automatic && controller.signal.aborted)) updateReadiness(false, publicFailure(error));
        }
        finally { activeAbort = null; probePromise = null; automaticProbe = false; if (!stopping) void drain(); }
        return { ...readiness, inProgress: false };
      })();
      return probePromise;
    };
    const drain = () => {
      if (worker || probePromise || stopping) return worker;
      worker = (async () => {
        while (!stopping) {
          const job = state.jobs.find(item => item.status === 'queued'); if (!job) break;
          const id = job.id;
          await change(next => { const item = next.jobs.find(item => item.id === id); if (item.status === 'queued') Object.assign(item, { status: 'running', attempt: (item.attempt || 0) + 1, updatedAt: now(), error: undefined }); });
          if (stopping) {
            await change(next => { const item = next.jobs.find(item => item.id === id); if (item.status === 'running') Object.assign(item, { status: 'queued', attempt: item.attempt - 1, updatedAt: now() }); });
            break;
          }
          if (state.jobs.find(item => item.id === id)?.status !== 'running') continue;
          const controller = new AbortController(); activeAbort = controller; activeJobId = id;
          const jobProfile = { ...active, model: job.model, version: job.profileVersion, ollamaUrl: job.ollamaUrl || active.ollamaUrl };
          try {
            const result = await infer(job.prompt, AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]), jobProfile);
            await change(next => { const item = next.jobs.find(item => item.id === id); if (item.status === 'running') Object.assign(item, { status: 'completed', result, updatedAt: now() }); });
            if (jobProfile.version === active.version) updateReadiness(true, 'Model odpowiedział podczas wykonania zadania.');
          } catch (error) {
            await change(next => { const item = next.jobs.find(item => item.id === id); if (item.status === 'running') Object.assign(item, { status: stopping ? 'queued' : 'failed', error: stopping ? undefined : publicFailure(error), updatedAt: now() }); });
            if (!stopping && !controller.signal.aborted && jobProfile.version === active.version) updateReadiness(false, publicFailure(error));
          } finally { activeAbort = null; activeJobId = null; }
        }
      })().catch(error => { updateReadiness(false, 'Nie udało się zapisać stanu zadania. Sprawdź miejsce i uprawnienia katalogu.'); options.onError?.(error); }).finally(() => { worker = null; });
      return worker;
    };
    const currentReadiness = async () => {
      const current = { ...readiness, inProgress: Boolean(startupHandle || startupPromise || probePromise) };
      const desired = validateProfile(await readJson(profileFile, active));
      if (JSON.stringify(desired) !== JSON.stringify(active)) return { ...current, state: 'NEEDS_ACTION', reason: 'Konfiguracja została zmieniona. Uruchom ponownie usługę, aby aktywować profil.' };
      if (readiness.state === 'READY' && Date.now() > Date.parse(readiness.expiresAt)) return { ...current, state: 'NEEDS_ACTION', reason: 'Wynik testu wygasł. Sprawdź model ponownie.' };
      return current;
    };
    const getStatus = async () => ({ name: 'JARVIS Runtime', version: VERSION, serverId: state.serverId, profileVersion: active.version, policy: active.policy, readiness: await currentReadiness(), queue: Object.fromEntries(['queued','running',...terminal].map(status => [status, state.jobs.filter(job => job.status === status).length])), archive: { count: state.archivedCount || 0 }, capabilities: { localAnalysis: true, coding: false, voice: false, processSandbox: false } });
    const listModels = async () => {
      try {
        const data = await modelRequest('/api/tags', undefined, AbortSignal.timeout(10000));
        if (!Array.isArray(data.models)) throw new RuntimeError('Nieprawidłowa lista modeli Ollamy.', 'INVALID_MODEL_RESPONSE', 502);
        return { models: data.models.slice(0, 100).filter(isLocalChatCandidate).map(item => ({ name: item.name })) };
      } catch (error) { throw error instanceof RuntimeError ? error : new RuntimeError('Nie można odczytać modeli lokalnej Ollamy.', 'MODEL_UNAVAILABLE', 502); }
    };
    let configurationChange = Promise.resolve();
    const setProfile = input => {
      const operation = configurationChange.then(async () => {
        if (typeof input.model !== 'string' || Object.keys(input).some(key => key !== 'model')) throw new RuntimeError('Możesz zmienić tylko nazwę lokalnego modelu.');
        let candidate = validateProfile({ ...active, model: input.model });
        if (candidate.model) {
          try { await checkModel(candidate, AbortSignal.timeout(10000)); }
          catch (error) { throw error instanceof RuntimeError ? error : new RuntimeError('Nie można sprawdzić wybranego lokalnego modelu.', 'MODEL_UNAVAILABLE', 502); }
        }
        await withProfileLock(dataDir, async () => {
          const saved = validateProfile(await readJson(profileFile, active));
          candidate = validateProfile({ ...candidate, version: Math.max(active.version, saved.version) + 1 });
          await atomicJson(profileFile, candidate); active = Object.freeze(candidate); requested = candidate;
        });
        readiness = { state: active.model ? 'NEEDS_ACTION' : 'SETUP', checkedAt: null, expiresAt: null, reason: active.model ? 'Wybrano model; wykonaj rzeczywisty test odpowiedzi.' : 'Wybierz i pobierz lokalny model Ollama.' };
        return { requested: active, active, readiness: { ...readiness, inProgress: Boolean(startupHandle || startupPromise || probePromise) } };
      });
      configurationChange = operation.catch(() => {}); return operation;
    };
    const prepareStartup = async () => {
      const initialVersion = active.version;
      const setupReason = reason => {
        if (!stopping && !active.model && active.version === initialVersion) readiness = { state: 'SETUP', checkedAt: now(), expiresAt: null, reason };
      };
      if (autoDiscover && !active.model && !stopping) {
        const signal = AbortSignal.any([lifetimeAbort.signal, AbortSignal.timeout(Math.max(100, Math.min(options.discoveryTimeoutMs ?? 4000, 5000)))]);
        try {
          const data = await modelRequest('/api/tags', undefined, signal);
          if (!Array.isArray(data.models)) throw new RuntimeError('Ollama zwróciła nieprawidłową listę modeli.', 'INVALID_MODEL_RESPONSE', 502);
          // Prefer lower loading cost; installed file size is a heuristic, not
          // a guarantee that the model fits the available RAM or GPU memory.
          const size = item => Number.isFinite(item.size) && item.size > 0 ? item.size : Number.MAX_SAFE_INTEGER;
          const candidates = data.models.slice(0, 100).filter(isLocalChatCandidate).sort((left, right) => size(left) - size(right) || left.name.localeCompare(right.name)).slice(0, 2);
          let chosen = null;
          for (const item of candidates) {
            try { await checkModel({ ...active, model: item.name }, signal); chosen = item.name; break; }
            catch (error) { if (signal.aborted) throw error; }
          }
          if (chosen) {
            const operation = configurationChange.then(() => withProfileLock(dataDir, async () => {
              if (stopping || active.model || active.version !== initialVersion) return;
              const saved = validateProfile(await readJson(profileFile, active));
              if (saved.model || saved.version !== initialVersion) return;
              const candidate = validateProfile({ ...active, model: chosen, version: active.version + 1 });
              await atomicJson(profileFile, candidate); active = Object.freeze(candidate); requested = candidate;
              readiness = { state: 'NEEDS_ACTION', checkedAt: null, expiresAt: null, reason: autoProbe ? 'Wybrano zainstalowany model. Sprawdzam rzeczywistą odpowiedź.' : 'Wybrano zainstalowany model; wykonaj test odpowiedzi.' };
            }));
            configurationChange = operation.catch(() => {});
            await operation;
          } else setupReason('Ollama działa, ale nie znaleziono potwierdzonego lokalnego modelu rozmowy. Wybierz model w panelu lub przygotuj go w Ollamie; automatyczne pobieranie jest wyłączone.');
        } catch (error) {
          setupReason(signal.aborted ? 'Automatyczne wykrywanie modeli przekroczyło czas oczekiwania. Sprawdź lokalną Ollamę lub wybierz model w panelu.' : error instanceof RuntimeError ? error.message : 'Lokalna Ollama jest niedostępna. Uruchom ją, a następnie wybierz model w panelu lub uruchom ponownie usługę JARVIS-a.');
        }
      }
      // Accepted work has priority: its own real inference will establish READY.
      if (autoProbe && !stopping && active.model && !worker && !probePromise && !state.jobs.some(job => job.status === 'queued' || job.status === 'running')) await probe({ automatic: true });
    };
    const archiveTerminal = async next => {
      const finished = next.jobs.filter(job => terminal.has(job.status));
      // Each immutable result is committed first. A crash before the queue commit
      // leaves a harmless duplicate; no result or idempotency key is lost.
      for (const job of finished) await atomicJson(archiveFile(job.idempotencyKey), job);
      next.jobs = next.jobs.filter(job => !terminal.has(job.status));
      next.archivedCount = (next.archivedCount || 0) + finished.length;
      return { archived: finished.length, total: next.archivedCount };
    };
    const archive = () => change(archiveTerminal);
    const enqueue = async (input) => {
      if (stopping) throw new RuntimeError('Runtime jest zamykany. Spróbuj ponownie po uruchomieniu usługi.', 'STOPPING', 503);
      if (!active.model) throw new RuntimeError('Najpierw wybierz lokalny model w panelu runtime.', 'MODEL_NOT_CONFIGURED', 422);
      if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > MAX_PROMPT) throw new RuntimeError(`Polecenie musi mieć od 1 do ${MAX_PROMPT} znaków.`);
      if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(input.idempotencyKey)) throw new RuntimeError('Wymagany identyfikator żądania: 8–128 znaków.');
      const prompt = input.prompt.trim();
      const result = await change(async next => {
        const existing = next.jobs.find(job => job.idempotencyKey === input.idempotencyKey);
        if (existing) { if (existing.prompt !== prompt) throw new RuntimeError('Identyfikator został już użyty dla innego polecenia.', 'IDEMPOTENCY_CONFLICT', 409); return { job: existing, reused: true }; }
        const archived = await readJson(archiveFile(input.idempotencyKey), null);
        if (archived) {
          if (!validJob(archived) || !terminal.has(archived.status) || archived.idempotencyKey !== input.idempotencyKey) throw new RuntimeError('Nieprawidłowy rekord archiwum; dane zachowano.', 'CORRUPT_STATE', 503);
          if (archived.prompt !== prompt) throw new RuntimeError('Identyfikator został już użyty dla innego polecenia.', 'IDEMPOTENCY_CONFLICT', 409);
          return { job: archived, reused: true };
        }
        if (next.jobs.length >= MAX_JOBS) await archiveTerminal(next);
        if (next.jobs.length >= MAX_JOBS) throw new RuntimeError('Kolejka ma 500 aktywnych zadań. Zaczekaj na zakończenie lub anuluj część zadań.', 'QUEUE_FULL', 429);
        const job = { id: randomUUID(), prompt, idempotencyKey: input.idempotencyKey, status: 'queued', createdAt: now(), updatedAt: now(), attempt: 0, profileVersion: active.version, model: active.model, ollamaUrl: active.ollamaUrl, execution: 'local-analysis' };
        next.jobs.push(job); return { job, reused: false };
      });
      if (probePromise && automaticProbe) activeAbort?.abort();
      void drain(); return result;
    };
    const cancel = async id => {
      const job = await change(next => { const item = next.jobs.find(item => item.id === id); if (!item) throw new RuntimeError('Nie znaleziono zadania.', 'NOT_FOUND', 404); if (!terminal.has(item.status)) Object.assign(item, { status: 'cancelled', updatedAt: now() }); return item; });
      if (activeJobId === id) activeAbort?.abort();
      return job;
    };
    const readBody = async req => {
      let bytes = 0; const chunks = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BODY) throw new RuntimeError('Żądanie przekroczyło limit rozmiaru.', 'BODY_TOO_LARGE', 413); chunks.push(chunk); }
      try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; }
      catch { throw new RuntimeError('Nieprawidłowy JSON.'); }
    };
    let url = null;
    const server = http.createServer(async (req, res) => {
      const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
      try {
        let host; try { host = new URL(`http://${req.headers.host || ''}`).hostname; } catch { host = ''; }
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new RuntimeError('Nieprawidłowy host.', 'FORBIDDEN_HOST', 403);
        const origin = req.headers.origin;
        if (origin && !origins.has(origin)) throw new RuntimeError('Ten klient nie jest dopuszczony.', 'FORBIDDEN_ORIGIN', 403);
        if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
        if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS'); res.writeHead(204); res.end(); return; }
        const supplied = Buffer.from(String(req.headers.authorization || '')); const expected = Buffer.from(`Bearer ${token}`);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new RuntimeError('Połącz aplikację z lokalnym runtime.', 'UNAUTHORIZED', 401);
        if (stopping) throw new RuntimeError('Runtime zatrzymuje pracę.', 'STOPPING', 503);
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        if (req.method === 'GET' && pathname === '/v1/status') return reply(200, await getStatus());
        if (req.method === 'GET' && pathname === '/v1/profile') return reply(200, { requested: validateProfile(await readJson(profileFile, active)), active, readiness: await currentReadiness() });
        if (req.method === 'GET' && pathname === '/v1/models') return reply(200, await listModels());
        if (req.method === 'PUT' && pathname === '/v1/profile') return reply(200, await setProfile(await readBody(req)));
        if (req.method === 'GET' && pathname === '/v1/jobs') return reply(200, { jobs: state.jobs });
        if (req.method === 'POST' && pathname === '/v1/jobs') { const result = await enqueue(await readBody(req)); return reply(result.reused ? 200 : 201, result); }
        if (req.method === 'POST' && pathname === '/v1/jobs/archive') return reply(200, await archive());
        const matched = pathname.match(/^\/v1\/jobs\/([a-f0-9-]+)\/cancel$/);
        if (req.method === 'POST' && matched) return reply(200, { job: await cancel(matched[1]) });
        if (req.method === 'POST' && pathname === '/v1/probe') return reply(200, { readiness: await probe() });
        if (req.method === 'POST' && pathname === '/v1/stop') { reply(202, { stopping: true }); setImmediate(() => { void close(); }); return; }
        throw new RuntimeError('Nieznany endpoint.', 'NOT_FOUND', 404);
      } catch (error) { if (!res.headersSent) reply(error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error instanceof RuntimeError ? error.message : 'Nie udało się obsłużyć żądania. Sprawdź usługę.' } }); else res.destroy(); }
    });
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    let closePromise;
    const close = () => closePromise ||= (async () => {
      stopping = true; lifetimeAbort.abort(); activeAbort?.abort();
      if (startupHandle) clearImmediate(startupHandle);
      await Promise.allSettled([worker, probePromise, configurationChange, startupPromise]); await mutation;
      if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
      await unlock();
    })();
    const start = async () => {
      try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 3211, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
        url = `http://127.0.0.1:${server.address().port}`;
        await atomicJson(path.join(dataDir, 'connection.json'), { url, token, serverId: state.serverId, pid: process.pid, version: VERSION });
        void drain();
        startupHandle = setImmediate(() => {
          startupHandle = null;
          if (!stopping) startupPromise = prepareStartup().catch(error => { if (!stopping) options.onError?.(error); }).finally(() => { startupPromise = null; });
        });
        return url;
      } catch (error) { await close(); throw error; }
    };
    return { start, close, server, token, dataDir, profile: active, getStatus, enqueue, cancel, probe };
  } catch (error) { await unlock(); throw error; }
}
