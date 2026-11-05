/** Durable scheduling backend for existing JARVIS goals. No model loop, daemon install or cloud fallback.
 * Store mutations use an exclusive process lock + fsync/rename. External work is fenced by a
 * persisted lease and criteria version; uncertain notification attempts are never blindly retried.
 */
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const dns = require('node:dns').promises;
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');

const SCHEMA = 1;
const MAX_BYTES = 1024 * 1024;
const MAX_ITEMS = 1000;
const MAX_GOALS = 200;
const MAX_EVENTS = 10000;
const LEASE_MS = 60000;
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => nodeCrypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, code = 'INVALID_INPUT') => Object.assign(new Error(message), { code });
const id = () => nodeCrypto.randomUUID();
const text = (value, max = 1000) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  if (net.isIPv6(address)) {
    const a = address.toLowerCase();
    // Public global unicast only. IPv4 mapped, loopback, ULA and link-local are excluded.
    return /^[23][0-9a-f]{3}:/.test(a) && !a.startsWith('2001:db8:');
  }
  return false;
}
function safeUrl(value) {
  if (!text(value, 4096)) throw fail('Adres jest pusty lub zbyt długi.');
  let url;
  try { url = new URL(value); } catch { throw fail('Wymagany poprawny adres źródła HTTPS/HTTP.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') && !net.isIP(host) || net.isIP(host) && !publicAddress(host)) throw fail('Źródło wymaga publicznego adresu bez hasła i fragmentu.');
  if ([...url.searchParams.keys()].some((key) => /token|secret|password|api.?key|auth/i.test(key))) throw fail('Nie zapisuj sekretów w adresie źródła.');
  return url.href;
}
async function normalizeSource(raw) {
  if (raw?.kind === 'changedetection' && text(raw.connectorId, 100) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.watchId || '')) return { kind: 'changedetection', connectorId: raw.connectorId, watchId: raw.watchId };
  if (raw?.kind === 'json') return { kind: 'json', url: safeUrl(raw.url) };
  if (raw?.kind === 'directory' && text(raw.path, 4096) && path.isAbsolute(raw.path)) {
    const real = await fsp.realpath(raw.path);
    if (!(await fsp.stat(real)).isDirectory()) throw fail('Źródło plików musi być katalogiem.');
    return { kind: 'directory', path: real };
  }
  throw fail('Dostępne źródła: publiczny JSON, wybrany katalog lub skonfigurowany watch changedetection.');
}
function normalizeCriteria(raw) {
  if (!text(raw?.contains, 500)) throw fail('Podaj kryterium tekstowe produktu lub pliku.');
  const value = { contains: raw.contains.trim() };
  for (const key of ['variant', 'condition']) if (raw[key] !== undefined) {
    if (!text(raw[key], 200)) throw fail(`Niepoprawne kryterium ${key}.`);
    value[key] = raw[key].trim();
  }
  if (raw.maxTotal !== undefined) {
    if (!Number.isFinite(raw.maxTotal) || raw.maxTotal < 0 || !/^[A-Z]{3}$/.test(raw.currency || '')) throw fail('Limit wymaga kwoty >= 0 i waluty ISO, np. PLN.');
    value.maxTotal = raw.maxTotal; value.currency = raw.currency;
  } else if (raw.currency !== undefined) {
    if (!/^[A-Z]{3}$/.test(raw.currency)) throw fail('Niepoprawna waluta.');
    value.currency = raw.currency;
  }
  return value;
}
function normalizeNotification(raw = {}) {
  if (raw.ntfy && (!text(raw.ntfy, 100) || raw.desktop === true)) throw fail('Wybierz jeden kanał zewnętrzny: desktop albo ntfy.');
  const out = { desktop: raw.desktop === true, muted: raw.muted === true, ...(raw.ntfy ? { ntfy: raw.ntfy } : {}) };
  if (raw.quietHours) {
    const { start, end } = raw.quietHours;
    if (![start, end].every((v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) || start === end) throw fail('Cisza nocna wymaga dwóch różnych godzin HH:mm.');
    out.quietHours = { start, end };
  }
  return out;
}
function quietAt(timestamp, notification, timezone) {
  if (!notification.quietHours) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(timestamp);
  const clock = `${parts.find((p) => p.type === 'hour').value}:${parts.find((p) => p.type === 'minute').value}`;
  const { start, end } = notification.quietHours;
  return start < end ? clock >= start && clock < end : clock >= start || clock < end;
}
function dayKey(timestamp, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp);
}
function normalizeSchedule(raw) {
  if (raw == null) return null;
  if (!['daily', 'weekly', 'monthly'].includes(raw.kind) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time || '')) throw fail('Harmonogram wymaga daily/weekly/monthly oraz godziny HH:mm.');
  const schedule = { kind: raw.kind, time: raw.time };
  if (raw.kind === 'weekly') {
    if (!Array.isArray(raw.weekdays) || raw.weekdays.length < 1 || raw.weekdays.length > 7 || raw.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw fail('Tydzień wymaga dni 0–6 (0 = niedziela).');
    schedule.weekdays = [...new Set(raw.weekdays)].sort();
  }
  if (raw.kind === 'monthly') {
    if (!Number.isInteger(raw.day) || raw.day < 1 || raw.day > 31) throw fail('Miesiąc wymaga dnia 1–31.');
    schedule.day = raw.day;
  }
  return schedule;
}
/** Wall-clock schedule: skip nonexistent spring times / missing month days, use only the
 * first occurrence of a repeated autumn time. Resume catches up once, then picks the future. */
function nextScheduledAt(schedule, after, timezone) {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = timestamp => Object.fromEntries(formatter.formatToParts(timestamp).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  const today = parts(after), [hour, minute] = schedule.time.split(':').map(Number);
  for (let offset = 0; offset < 371; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (schedule.kind === 'weekly' && !schedule.weekdays.includes(date.getUTCDay()) || schedule.kind === 'monthly' && schedule.day !== date.getUTCDate()) continue;
    const wall = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
    const candidates = new Set();
    for (const hours of [-36, 0, 36]) {
      const sample = wall + hours * 3600000, local = parts(sample);
      const zoneOffset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - sample;
      const candidate = wall - zoneOffset, actual = parts(candidate);
      if (actual.year === date.getUTCFullYear() && actual.month === date.getUTCMonth() + 1 && actual.day === date.getUTCDate() && actual.hour === hour && actual.minute === minute) candidates.add(candidate);
    }
    if (candidates.size) { const first = Math.min(...candidates); if (first > after) return first; }
  }
  throw fail('Nie znaleziono następnego terminu w ciągu roku.');
}
function money(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function matched(item, criteria) {
  const title = `${item.title || ''} ${item.text || ''}`.toLocaleLowerCase('pl');
  if (criteria.contains !== '*' && !criteria.contains.toLocaleLowerCase('pl').split(/\s+/u).every((word) => title.includes(word))) return false;
  if (item.available !== true) return false;
  for (const key of ['variant', 'condition', 'currency']) if (criteria[key] && criteria[key] !== item[key]) return false;
  if (criteria.maxTotal !== undefined && (money(item.price) === null || money(item.shipping) === null || item.price + item.shipping > criteria.maxTotal)) return false;
  return true;
}
function retryAfter(value, now) {
  if (!value) return 0;
  const seconds = Number(value);
  const timestamp = Number.isFinite(seconds) && seconds >= 0 ? now + seconds * 1000 : Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(now, timestamp) : 0;
}
/** DNS is resolved and pinned for this request; redirects cannot escape the granted URL. */
async function publicFetch(urlString, { signal }) {
  const url = new URL(safeUrl(urlString));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw fail('Źródło rozwiązuje się do niepublicznego adresu.', 'SOURCE_BLOCKED');
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal, timeout: 15000, headers: { accept: 'application/json', 'user-agent': 'Jarvis-ReadOnlyMonitor/1' },
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
    }, (response) => {
      let size = 0; const chunks = [];
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) response.destroy(fail('Odpowiedź przekracza limit 1 MiB.', 'SOURCE_FORMAT'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: { get: (name) => response.headers[name.toLowerCase()] || null }, text: async () => Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(fail('Timeout źródła.', 'SOURCE_TIMEOUT')));
    request.on('error', reject);
  });
}
async function readSource(source, { fetch, signal, now }) {
  if (source.kind === 'directory') {
    // Linux descriptor pins the exact granted directory while iterating; path replacement or
    // symlinks cannot redirect a running read into another directory. Other hosts fail explicitly.
    if (process.platform !== 'linux') throw fail('Adapter katalogu wymaga obecnie Linuksa.', 'SOURCE_BLOCKED');
    const handle = await fsp.open(source.path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      const pinned = `/proc/self/fd/${handle.fd}`;
      if (await fsp.realpath(pinned) !== source.path) throw fail('Katalog zmienił tożsamość.', 'SOURCE_BLOCKED');
      const entries = await fsp.readdir(pinned, { withFileTypes: true });
      if (entries.length > MAX_ITEMS) throw fail('Katalog przekracza limit 1000 wpisów.', 'SOURCE_FORMAT');
      const items = [];
      for (const entry of entries) {
        if (signal.aborted) throw fail('Anulowano odczyt.', 'ABORTED');
        if (!entry.isFile()) continue;
        const stat = await fsp.lstat(path.join(pinned, entry.name));
        if (!stat.isFile()) continue;
        items.push({ id: entry.name, title: entry.name, url: path.join(source.path, entry.name), available: true, modifiedAt: stat.mtimeMs, bytes: stat.size });
      }
      return { items, observedAt: now, mode: 'directory-names-only' };
    } finally { await handle.close(); }
  }
  const response = await fetch(source.url, { signal, redirect: 'error' });
  const status = response.status;
  if (status === 429) throw Object.assign(fail('Źródło ogranicza częstotliwość (429).', 'RATE_LIMIT'), { retryAt: retryAfter(response.headers.get('retry-after'), now) });
  if (status === 401 || status === 403) throw fail(`Źródło odmawia dostępu (${status}).`, 'SOURCE_AUTH');
  if (status >= 300 && status < 400) throw fail('Źródło przekierowuje; wymagana nowa jawna zgoda na adres.', 'SOURCE_BLOCKED');
  if (status !== 200) throw fail(`Źródło zwróciło HTTP ${status}.`, 'SOURCE_UNAVAILABLE');
  if (!/application\/(?:[\w.+-]*\+)?json/i.test(response.headers.get('content-type') || '')) throw fail('Źródło nie zwróciło JSON.', 'SOURCE_FORMAT');
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw fail('Odpowiedź przekracza limit 1 MiB.', 'SOURCE_FORMAT');
  let parsed;
  try { parsed = JSON.parse(body); } catch { throw fail('Niepoprawny JSON źródła.', 'SOURCE_FORMAT'); }
  const items = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw fail('Źródło wymaga tablicy items (maksymalnie 1000).', 'SOURCE_FORMAT');
  const seen = new Map();
  for (const item of items) {
    if (!item || !text(item.id, 500) || !text(item.title, 1000) || typeof item.available !== 'boolean') throw fail('Niepełny rekord źródła: wymagane id/title/url/available.', 'SOURCE_FORMAT');
    item.url = safeUrl(item.url);
    // Contradictory duplicate ids make a snapshot incomplete; identical duplicates are harmless.
    const signature = hash(item);
    const previous = seen.get(item.id);
    if (previous && previous !== signature) throw fail('Źródło zawiera sprzeczne duplikaty id.', 'SOURCE_FORMAT');
    seen.set(item.id, signature);
  }
  return { items, observedAt: now, mode: 'public-json-snapshot' };
}

function createGoalService(options) {
  if (!path.isAbsolute(options?.directory || '')) throw fail('Wymagany bezwzględny katalog stanu.');
  const directory = options.directory;
  const stateFile = path.join(directory, 'goals-v1.json');
  const lockDir = path.join(directory, '.goals-lock');
  const clock = options.now || Date.now;
  const transport = options.fetch || publicFetch;
  const notify = options.notify;
  // Constructor-only injection can shorten deadlines for controlled tests; renderer commands
  // cannot change these budgets or lengthen production limits.
  const checkTimeoutMs = Number.isSafeInteger(options.checkTimeoutMs) && options.checkTimeoutMs > 0 ? Math.min(options.checkTimeoutMs, 20000) : 20000;
  const notificationTimeoutMs = Number.isSafeInteger(options.notificationTimeoutMs) && options.notificationTimeoutMs > 0 ? Math.min(options.notificationTimeoutMs, 15000) : 15000;
  const owner = `${process.pid}:${id()}`;
  let timer = null; let running = false; let closed = false; let tickActive = false;
  const active = new Map();
  const activeNotifications = new Map();
  const fresh = () => ({ schemaVersion: SCHEMA, revision: 0, goals: [], grants: [], events: [], journal: [] });
  async function lock() {
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + 3000;
    while (true) {
      try {
        await fsp.mkdir(lockDir, { mode: 0o700 });
        await fsp.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, owner }), { mode: 0o600 });
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let old;
        try { old = JSON.parse(await fsp.readFile(path.join(lockDir, 'owner.json'), 'utf8')); } catch { /* Lock creation may still be writing owner; fail closed if it remains incomplete. */ }
        if (Number.isSafeInteger(old?.pid) && old.pid > 0) {
          try { process.kill(old.pid, 0); } catch (error) {
            if (error.code === 'ESRCH') {
              // rename elects one scavenger; a contender must not remove a newly acquired lock.
              const recovery = `${lockDir}.recovery`;
              let recovering = false;
              try {
                await fsp.mkdir(recovery); recovering = true;
                const current = JSON.parse(await fsp.readFile(path.join(lockDir, 'owner.json'), 'utf8'));
                if (current.owner === old.owner) {
                  const abandoned = `${lockDir}.abandoned-${id()}`;
                  await fsp.rename(lockDir, abandoned); await fsp.rm(abandoned, { recursive: true });
                }
              } catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
              finally { if (recovering) await fsp.rmdir(recovery); }
              continue;
            }
          }
        }
        if (Date.now() > deadline) throw fail('Magazyn zajęty lub blokada wymaga sprawdzenia.', 'STORE_LOCKED');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }
  async function transaction(fn, write = true) {
    await lock();
    try {
      let state; let exists = true;
      try { state = JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch (error) {
        if (error.code === 'ENOENT') { state = fresh(); exists = false; } else throw fail('Uszkodzony magazyn celów: zatrzymano wykonanie.', 'STORE_CORRUPT');
      }
      if (state.schemaVersion !== SCHEMA || !['goals', 'grants', 'events', 'journal'].every((key) => Array.isArray(state[key]))) throw fail('Nieobsługiwana lub uszkodzona wersja magazynu.', 'STORE_CORRUPT');
      const before = write ? JSON.stringify(state) : null;
      const result = await fn(state);
      if (write && (!exists || JSON.stringify(state) !== before)) {
        state.revision += 1;
        const temporary = `${stateFile}.${id()}.tmp`;
        const handle = await fsp.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
        try { await fsp.rename(temporary, stateFile); } catch (error) { await fsp.unlink(temporary).catch(() => {}); throw error; }
        const dir = await fsp.open(directory, 'r');
        try { await dir.sync(); } finally { await dir.close(); }
      }
      return clone(result === undefined ? null : result);
    } finally {
      await fsp.rm(lockDir, { recursive: true });
    }
  }
  function log(state, goal, action, detail) {
    state.journal.push({ id: id(), goalId: goal?.id || null, at: clock(), action, detail });
    if (state.journal.length > 2000) state.journal.splice(0, state.journal.length - 2000);
  }
  function grantFor(state, goal) {
    return state.grants.find((grant) => grant.id === goal.grantId && !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > clock()) && hash(grant.source) === hash(goal.source) && (!goal.notification.desktop || grant.desktopNotification) && (!goal.notification.ntfy || grant.ntfyNotification === goal.notification.ntfy));
  }
  function validLease(state, claim) {
    const goal = state.goals.find((g) => g.id === claim.id);
    return goal && goal.state === 'RUNNING' && goal.criteriaVersion === claim.criteriaVersion && goal.lease?.token === claim.lease.token && goal.lease.until > clock() && grantFor(state, goal) ? goal : null;
  }
  function abortGoal(goalId) { active.get(goalId)?.abort(); activeNotifications.get(goalId)?.abort(); }
  async function command(request, context = {}) {
    if (!request || typeof request.action !== 'string') throw fail('Brak działania.');
    const action = request.action;
    let source;
    if (action === 'grant' || action === 'create') source = await normalizeSource(request.source);
    if (action === 'grant' && context.trustedUserAction !== true) throw fail('Zgodę może nadać wyłącznie użytkownik w ustawieniach.', 'APPROVAL_REQUIRED');
    return transaction((state) => {
      const now = clock();
      if (action === 'list') return { goals: state.goals, events: state.events, grants: state.grants, runtime: { active: running, host: 'desktop-main-process', observationGap: 'Podczas uśpienia i wyłączenia hosta nie wykonuje się sprawdzeń.', schemaVersion: SCHEMA } };
      if (action === 'grant') {
        if (request.expiresAt !== undefined && (!Number.isFinite(request.expiresAt) || request.expiresAt <= now)) throw fail('Zgoda wymaga przyszłego terminu.');
        const grant = { id: id(), source, desktopNotification: request.desktopNotification === true, ntfyNotification: text(request.ntfyNotification, 100), createdAt: now, expiresAt: request.expiresAt || null, revokedAt: null };
        state.grants.push(grant);
        for (const goal of state.goals) if (goal.state === 'WAITING_APPROVAL' && hash(goal.source) === hash(source) && (!goal.notification.desktop || grant.desktopNotification) && (!goal.notification.ntfy || grant.ntfyNotification === goal.notification.ntfy)) goal.grantId = grant.id;
        log(state, null, 'GRANT', { id: grant.id, source }); return grant;
      }
      if (action === 'create') {
        if (state.goals.length >= MAX_GOALS) throw fail('Limit 200 zapisanych celów.', 'RESOURCE_LIMIT');
        const criteria = normalizeCriteria(request.criteria);
        if (!text(request.title, 500) || !text(request.originalCommand, 4000)) throw fail('Cel wymaga tytułu i oryginalnego polecenia.');
        const intervalMs = request.intervalMs ?? 15 * 60000;
        if (!Number.isSafeInteger(intervalMs) || intervalMs < 60000 || intervalMs > 30 * 86400000) throw fail('Interwał musi wynosić od minuty do 30 dni.');
        const budgetPerDay = request.budgetPerDay ?? 1440;
        if (!Number.isSafeInteger(budgetPerDay) || budgetPerDay < 1 || budgetPerDay > 10000) throw fail('Budżet wymaga 1–10000 sprawdzeń na dzień.');
        const timezone = request.timezone || 'Europe/Warsaw';
        try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now); } catch { throw fail('Niepoprawna strefa czasowa.'); }
        const schedule = normalizeSchedule(request.schedule);
        const notification = normalizeNotification(request.notification);
        const grant = state.grants.find((g) => !g.revokedAt && (!g.expiresAt || g.expiresAt > now) && hash(g.source) === hash(source) && (!notification.desktop || g.desktopNotification) && (!notification.ntfy || g.ntfyNotification === notification.ntfy));
        if (!grant) throw fail('Źródło lub kanał wymaga zakresowej zgody użytkownika.', 'APPROVAL_REQUIRED');
        const goal = { id: id(), title: request.title.trim(), originalCommand: request.originalCommand.trim(), type: 'monitor', state: 'WAITING_TIMER', source, criteria, criteriaVersion: 1, grantId: grant.id, intervalMs, schedule, budgetPerDay, budget: { day: dayKey(now, timezone), used: 0 }, timezone, notification, stopAfterFirst: request.stopAfterFirst !== false, createdAt: now, updatedAt: now, nextCheckAt: schedule ? nextScheduledAt(schedule, now, timezone) : now, lastCheckAt: null, lastSuccessAt: null, lastResult: 'NOT_CHECKED', failures: 0, observations: {}, lease: null };
        state.goals.push(goal); log(state, goal, 'CREATED', { criteriaVersion: 1 }); return goal;
      }
      if (action === 'stop_all') {
        for (const goal of state.goals) if (!['COMPLETED', 'CANCELLED', 'FAILED'].includes(goal.state)) { goal.state = 'CANCELLED'; goal.lease = null; goal.nextCheckAt = null; goal.updatedAt = now; abortGoal(goal.id); log(state, goal, 'CANCELLED', 'global-stop'); }
        for (const event of state.events) if (['QUEUED', 'RETRY'].includes(event.state)) event.state = 'CANCELLED';
        for (const controller of activeNotifications.values()) controller.abort();
        return { stopped: true };
      }
      if (action === 'revoke') {
        const grant = state.grants.find((g) => g.id === request.id);
        if (!grant) throw fail('Nie znaleziono zgody.');
        grant.revokedAt = now;
        for (const goal of state.goals.filter((g) => g.grantId === grant.id && !['COMPLETED', 'CANCELLED', 'FAILED'].includes(g.state))) { goal.state = 'WAITING_APPROVAL'; goal.lease = null; goal.nextCheckAt = null; goal.updatedAt = now; abortGoal(goal.id); }
        for (const event of state.events) if (state.goals.some((g) => g.id === event.goalId && g.grantId === grant.id) && ['QUEUED', 'RETRY'].includes(event.state)) event.state = 'CANCELLED';
        for (const goal of state.goals) if (goal.grantId === grant.id) activeNotifications.get(goal.id)?.abort();
        log(state, null, 'REVOKED', { id: grant.id }); return grant;
      }
      if (action === 'read_event') {
        if (context.trustedUserAction !== true) throw fail('Odczyt potwierdza użytkownik.', 'APPROVAL_REQUIRED');
        const event = state.events.find((e) => e.id === request.id); if (!event) throw fail('Brak zdarzenia.'); event.readAt = now; return event;
      }
      const goal = state.goals.find((g) => g.id === request.id);
      if (!goal) throw fail('Nie znaleziono celu.');
      if (action === 'pause') { if (['CANCELLED', 'COMPLETED', 'FAILED'].includes(goal.state)) throw fail('Zakończonego celu nie można wstrzymać ani ponownie uruchomić.'); goal.state = 'PAUSED'; goal.lease = null; goal.nextCheckAt = null; abortGoal(goal.id); }
      else if (action === 'cancel') {
        goal.state = 'CANCELLED'; goal.lease = null; goal.nextCheckAt = null; abortGoal(goal.id);
        for (const event of state.events) if (event.goalId === goal.id && ['QUEUED', 'RETRY'].includes(event.state)) event.state = 'CANCELLED';
      } else if (action === 'resume') {
        if (goal.state === 'CANCELLED' || goal.state === 'COMPLETED') throw fail('Zakończony/anulowany cel nie może zostać samoczynnie wznowiony.');
        if (goal.state === 'RUNNING') throw fail('Cel jest już wykonywany.');
        if (!grantFor(state, goal)) throw fail('Zgoda wygasła lub została odwołana.', 'APPROVAL_REQUIRED');
        goal.state = 'WAITING_TIMER'; goal.nextCheckAt = now; goal.failures = 0;
      } else if (action === 'update') {
        if (['CANCELLED', 'COMPLETED'].includes(goal.state)) throw fail('Zakończony cel wymaga nowego polecenia.');
        goal.criteria = normalizeCriteria(request.criteria); goal.criteriaVersion += 1; goal.observations = {}; goal.lease = null; abortGoal(goal.id);
        if (goal.state !== 'PAUSED') { goal.state = 'WAITING_TIMER'; goal.nextCheckAt = now; }
        for (const event of state.events) if (event.goalId === goal.id && ['QUEUED', 'RETRY'].includes(event.state)) event.state = 'CANCELLED';
      } else if (action === 'mute') { goal.notification.muted = request.muted !== false; }
      else throw fail('Nieobsługiwane działanie monitora.');
      goal.updatedAt = now; log(state, goal, action.toUpperCase(), { criteriaVersion: goal.criteriaVersion }); return goal;
    }, action !== 'list');
  }
  async function claimGoal() {
    return transaction((state) => {
      const now = clock();
      for (const goal of state.goals) {
        if (goal.state === 'RUNNING' && goal.lease?.until <= now) { goal.state = 'WAITING_TIMER'; goal.lease = null; goal.nextCheckAt = now; log(state, goal, 'RECOVERED', 'Wygasła dzierżawa; ponawiany wyłącznie odczyt źródła.'); }
        if (goal.state !== 'WAITING_TIMER' || goal.nextCheckAt > now) continue;
        if (!grantFor(state, goal)) { goal.state = 'WAITING_APPROVAL'; goal.nextCheckAt = null; continue; }
        const day = dayKey(now, goal.timezone);
        if (goal.budget.day !== day) goal.budget = { day, used: 0 };
        if (goal.budget.used >= goal.budgetPerDay) { goal.lastResult = 'WAITING_BUDGET'; goal.nextCheckAt = now + Math.min(goal.intervalMs, 60000); continue; }
        goal.budget.used++; goal.state = 'RUNNING'; goal.lastCheckAt = now; goal.updatedAt = now;
        goal.lease = { owner, token: id(), until: now + LEASE_MS };
        log(state, goal, 'CHECK_STARTED', { attemptId: goal.lease.token, criteriaVersion: goal.criteriaVersion });
        return goal;
      }
      return null;
    });
  }
  async function check(claim) {
    const controller = new AbortController(); active.set(claim.id, controller);
    let timeout;
    try {
      // Recheck after acquiring the lease and before I/O, including grants/criteria/cancel.
      if (!await transaction((state) => !!validLease(state, claim), false)) return;
      const sourceRead = claim.source.kind === 'changedetection'
        ? options.connectors ? options.connectors.readSource(claim.source, { signal: controller.signal, now: clock() }) : Promise.reject(fail('Integracja changedetection nie jest skonfigurowana.', 'SOURCE_AUTH'))
        : readSource(claim.source, { fetch: transport, signal: controller.signal, now: clock() });
      const snapshot = await Promise.race([sourceRead, new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(fail('Timeout źródła.', 'SOURCE_TIMEOUT')); }, checkTimeoutMs); timeout.unref?.(); })]);
      snapshot.observedAt = clock();
      await transaction((state) => {
        const goal = validLease(state, claim); if (!goal || controller.signal.aborted) return;
        if (goal.source.kind === 'changedetection' && options.connectors?.isRevoked?.(goal.source.connectorId)) throw fail('Dostęp do integracji został odwołany.', 'SOURCE_AUTH');
        let matches = 0; let changed = false;
        const baseline = goal.source.kind === 'changedetection' && Object.keys(goal.observations).length === 0;
        for (const item of snapshot.items) {
          const previous = Object.hasOwn(goal.observations, item.id) ? goal.observations[item.id] : null;
          if (!previous && Object.keys(goal.observations).length >= 10000) throw fail('Limit pamięci obserwacji wymaga decyzji o retencji.', 'RESOURCE_LIMIT');
          const fingerprint = hash([item.id, item.available, item.price ?? null, item.shipping ?? null, item.currency ?? null, item.modifiedAt ?? null]);
          const changeRevision = previous ? (previous.changeRevision || 0) + (previous.fingerprint !== fingerprint || previous.available !== item.available ? 1 : 0) : 0;
          const generation = previous ? previous.generation + (previous.available === false && item.available === true ? 1 : 0) : 0;
          const isChange = goal.source.kind !== 'changedetection' || previous && previous.fingerprint !== fingerprint;
          if (isChange) changed = true;
          if (isChange && matched(item, goal.criteria)) {
            matches++;
            const eventId = hash([goal.id, goal.criteriaVersion, item.id, fingerprint, generation, changeRevision]);
            if (!state.events.some((e) => e.id === eventId)) {
              if (state.events.length >= MAX_EVENTS) throw fail('Centrum zdarzeń osiągnęło limit; wymagany eksport/retencja.', 'RESOURCE_LIMIT');
              state.events.push({ id: eventId, goalId: goal.id, criteriaVersion: goal.criteriaVersion, sourceMode: snapshot.mode, title: item.title, url: item.url, price: money(item.price), shipping: money(item.shipping), total: money(item.price) !== null && money(item.shipping) !== null ? item.price + item.shipping : null, currency: typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency) ? item.currency : null, publishedAt: typeof item.publishedAt === 'string' && Number.isFinite(Date.parse(item.publishedAt)) ? item.publishedAt : null, observedAt: snapshot.observedAt, reason: goal.criteria, kind: !previous ? 'NEW_MATCH' : previous.available === false ? 'AVAILABLE_AGAIN' : 'CHANGED_MATCH', state: goal.notification.desktop || goal.notification.ntfy ? 'QUEUED' : 'IN_APP', channel: goal.notification.ntfy ? 'ntfy' : 'desktop', connectorId: goal.notification.ntfy || null, sourceCheckedAt: item.sourceCheckedAt || null, attempts: 0, nextAttemptAt: clock(), readAt: null, deliveredAt: null, acceptedAt: null });
            }
          }
          Object.defineProperty(goal.observations, item.id, { value: { fingerprint, available: item.available, generation, changeRevision }, enumerable: true, configurable: true, writable: true });
        }
        // A complete snapshot omitting an earlier record establishes absence, not an invented price.
        const currentIds = new Set(snapshot.items.map((item) => item.id));
        for (const [itemId, observation] of Object.entries(goal.observations)) if (!currentIds.has(itemId)) observation.available = false;
        goal.lastSourceCheckAt = snapshot.items.find(item => Number.isFinite(item.sourceCheckedAt))?.sourceCheckedAt || null;
        goal.lastSuccessAt = clock(); goal.lastResult = matches ? 'MATCH' : baseline ? 'BASELINE_RECORDED' : goal.source.kind === 'changedetection' && !changed ? 'NO_CHANGE' : 'NO_MATCH'; goal.lastError = null; goal.failures = 0; goal.lease = null;
        goal.state = matches && goal.stopAfterFirst ? 'COMPLETED' : 'WAITING_TIMER';
        goal.nextCheckAt = goal.state === 'COMPLETED' ? null : goal.schedule ? nextScheduledAt(goal.schedule, clock(), goal.timezone) : clock() + goal.intervalMs;
        goal.updatedAt = clock(); log(state, goal, 'CHECK_FINISHED', { matches, result: goal.lastResult, sourceMode: snapshot.mode });
      });
    } catch (error) {
      await transaction((state) => {
        const goal = validLease(state, claim); if (!goal) return;
        goal.failures++; goal.lease = null; goal.updatedAt = clock();
        const code = error.code || (controller.signal.aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_UNAVAILABLE');
        goal.lastError = { code, at: clock(), message: ['SOURCE_AUTH','SOURCE_BLOCKED','SOURCE_FORMAT','RESOURCE_LIMIT','RATE_LIMIT'].includes(code) ? error.message : 'Odczyt źródła nie powiódł się; nie oznacza to braku dopasowania.' };
        goal.lastResult = 'SOURCE_ERROR';
        if (['SOURCE_AUTH','SOURCE_BLOCKED','SOURCE_FORMAT','RESOURCE_LIMIT'].includes(code)) { goal.state = code === 'SOURCE_AUTH' ? 'WAITING_INPUT' : 'BLOCKED'; goal.nextCheckAt = null; }
        else { goal.state = 'WAITING_TIMER'; const backoff = Math.min(3600000, goal.intervalMs * (2 ** Math.min(goal.failures, 10))); goal.nextCheckAt = Math.max(clock() + backoff, error.retryAt || 0); }
        log(state, goal, 'CHECK_ERROR', goal.lastError);
      });
    } finally { clearTimeout(timeout); if (active.get(claim.id) === controller) active.delete(claim.id); }
  }
  async function deliverOne() {
    const event = await transaction((state) => {
      const now = clock();
      for (const event of state.events) {
        if (event.state === 'SENDING' && event.lease?.until <= now) { event.state = 'UNCERTAIN'; log(state, null, 'NOTIFICATION_UNCERTAIN', { eventId: event.id }); }
        if (!['QUEUED', 'RETRY'].includes(event.state) || event.nextAttemptAt > now) continue;
        const goal = state.goals.find((g) => g.id === event.goalId);
        if (!goal || !grantFor(state, goal) || goal.state === 'CANCELLED' || goal.criteriaVersion !== event.criteriaVersion) { event.state = 'CANCELLED'; continue; }
        if (goal.notification.muted || goal.state === 'PAUSED' || quietAt(now, goal.notification, goal.timezone)) continue;
        if (!(event.channel === 'ntfy' ? options.connectors?.notify : notify)) { event.state = 'BLOCKED'; event.lastError = 'Systemowy kanał powiadomień niedostępny; wynik pozostaje w centrum.'; continue; }
        event.state = 'SENDING'; event.attempts++; event.lease = { owner, token: id(), until: now + LEASE_MS }; return event;
      }
      return null;
    });
    if (!event) return;
    const controller = new AbortController(); activeNotifications.set(event.goalId, controller);
    try {
      // Reconcile persisted identity immediately before the external side effect.
      if (!await transaction((state) => { const current = state.events.find((e) => e.id === event.id); const goal = state.goals.find((g) => g.id === event.goalId); return !!(current?.state === 'SENDING' && current.lease?.token === event.lease.token && current.lease.until > clock() && goal && grantFor(state, goal) && goal.state !== 'CANCELLED' && goal.criteriaVersion === event.criteriaVersion); }, false)) return;
      let timeout; let result;
      try { result = await Promise.race([event.channel === 'ntfy' ? options.connectors.notify(clone(event), { signal: controller.signal }) : notify(clone(event), { signal: controller.signal }), new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(fail('Nieznany wynik powiadomienia.', 'NOTIFICATION_TIMEOUT')); }, notificationTimeoutMs); timeout.unref?.(); })]); }
      finally { clearTimeout(timeout); }
      await transaction((state) => {
        const current = state.events.find((e) => e.id === event.id);
        if (!current || current.lease?.token !== event.lease.token || current.state !== 'SENDING') return;
        if (result?.accepted === true) { current.state = 'ACCEPTED'; current.acceptedAt = clock(); current.providerId = typeof result.providerId === 'string' ? result.providerId.slice(0, 200) : null; }
        else if (result?.accepted === false && result?.retryable === true && current.attempts < 5) { current.state = 'RETRY'; current.nextAttemptAt = Math.max(clock() + Math.min(3600000, 30000 * 2 ** current.attempts), Number.isFinite(result.retryAt) ? result.retryAt : 0); }
        else { current.state = result?.accepted === false ? 'BLOCKED' : 'UNCERTAIN'; }
        current.lease = null;
      });
    } catch {
      await transaction((state) => { const current = state.events.find((e) => e.id === event.id); if (current?.lease?.token === event.lease.token) { current.state = 'UNCERTAIN'; current.lease = null; } });
    } finally { if (activeNotifications.get(event.goalId) === controller) activeNotifications.delete(event.goalId); }
  }
  async function tick() {
    if (closed || tickActive) return;
    tickActive = true;
    try { const claim = await claimGoal(); if (claim && !closed) await check(claim); if (!closed) await deliverOne(); }
    finally { tickActive = false; }
  }
  function start() {
    if (running) return;
    closed = false; running = true;
    timer = setInterval(() => { void tick().catch((error) => { options.onError?.({ code: error.code || 'STORE_ERROR', message: error.message }); }); }, 1000);
    timer.unref?.();
    void tick().catch((error) => { options.onError?.({ code: error.code || 'STORE_ERROR', message: error.message }); });
  }
  async function stop() {
    closed = true; running = false; if (timer) clearInterval(timer); timer = null;
    for (const controller of active.values()) controller.abort();
    for (const controller of activeNotifications.values()) controller.abort();
  }
  return { command, tick, start, stop };
}
module.exports = { createGoalService, publicFetch, publicAddress, quietAt, retryAfter, nextScheduledAt, normalizeSchedule };
