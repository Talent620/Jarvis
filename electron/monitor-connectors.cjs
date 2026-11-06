// Main-process adapters. Configuration is an owner action; secrets never enter goal records.
const fs = require('node:fs').promises;
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { publicAddress, retryAfter } = require('./goal-service.cjs');
const error = (message, code = 'MISSING_CONFIGURATION') => Object.assign(new Error(message), { code });
const bounded = (value, size) => typeof value === 'string' && value.length > 0 && value.length <= size && !/[\r\n\0]/.test(value);
const loopback = (host) => host === 'localhost' || host === '::1' || /^127\./.test(host);
function baseUrl(value, allowLocal = false) {
  if (!bounded(value, 2048)) throw error('Podaj adres usługi bez danych logowania.');
  let url; try { url = new URL(value); } catch { throw error('Niepoprawny adres usługi.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) throw error('Adres usługi nie może zawierać hasła, query ani fragmentu.');
  if (loopback(host)) { if (!allowLocal) throw error('Lokalna usługa wymaga osobnej zgody.'); }
  else if (url.protocol !== 'https:' || net.isIP(host) && !publicAddress(host) || !host.includes('.')) throw error('Usługa wymaga publicznego HTTPS albo jawnie dozwolonego loopback.');
  return url.href.replace(/\/+$/, '') + '/';
}
function watchSpec(input) {
  // Control characters must be rejected in the owner-visible consent dialog.
  // eslint-disable-next-line no-control-regex
  if (!input || !bounded(input.connectorId, 100) || !bounded(input.url, 2048) || !bounded(input.title, 200) || !input.title.trim() || /[{}\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(input.title) || !Number.isSafeInteger(input.intervalMs) || input.intervalMs < 60000 || input.intervalMs > 30 * 86400000 || input.intervalMs % 1000) throw error('Podaj integrację, adres, nazwę i interwał od minuty do 30 dni.', 'SOURCE_FORMAT');
  let url; try { url = new URL(input.url); } catch { throw error('Niepoprawny adres monitorowanej strony.', 'SOURCE_FORMAT'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  let decoded; try { decoded = decodeURIComponent(url.pathname + url.search); } catch { throw error('Niepoprawne kodowanie adresu.', 'SOURCE_FORMAT'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || host === 'localhost' || host.endsWith('.localhost') || (!host.includes('.') && !net.isIP(host)) || (net.isIP(host) && !publicAddress(host)) || /[{}\r\n\0]/.test(decoded) || [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|auth/i.test(key))) throw error('Watch wymaga publicznego adresu bez sekretów i szablonów.', 'SOURCE_FORMAT');
  return { connectorId: input.connectorId, url: url.href, title: input.title.trim(), intervalMs: input.intervalMs };
}
async function request(urlString, options = {}) {
  const url = new URL(urlString), host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await dns.lookup(host, { all: true });
  const local = options.allowLocal && loopback(host);
  if (!addresses.length || addresses.some(a => local ? !loopback(a.address) : !publicAddress(a.address))) throw error('DNS usługi wskazuje nieautoryzowany adres.', 'SOURCE_BLOCKED');
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method: options.method || 'GET', signal: options.signal, timeout: 12000,
      headers: { accept: 'application/json', ...options.headers },
      lookup: (_host, opts, callback) => opts?.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
    }, res => {
      let bytes = 0; const chunks = [];
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) res.destroy(error('Limit odpowiedzi usługi 1 MiB.', 'SOURCE_FORMAT')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: { get: name => res.headers[name.toLowerCase()] || null }, text: async () => Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(error('Timeout usługi.', 'SOURCE_TIMEOUT'))); req.on('error', reject);
    req.end(options.body);
  });
}
function createMonitorConnectors(options) {
  if (!path.isAbsolute(options?.directory || '')) throw error('Wymagany katalog konfiguracji.');
  const file = path.join(options.directory, 'monitor-connectors.enc');
  const transport = options.request || request;
  let mutations = Promise.resolve();
  const revoked = new Set(), active = new Map();
  function operation(connectorId, signal) {
    const controller = new AbortController(), abort = () => controller.abort();
    if (signal?.aborted || revoked.has(connectorId)) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (!active.has(connectorId)) active.set(connectorId, new Set());
    active.get(connectorId).add(controller);
    return { controller, assert() { if (controller.signal.aborted || revoked.has(connectorId)) throw error('Odczyt integracji anulowano lub cofnięto dostęp.', 'SOURCE_AUTH'); },
      finish() { signal?.removeEventListener('abort', abort); const operations = active.get(connectorId); operations?.delete(controller); if (!operations?.size) active.delete(connectorId); } };
  }
  function protectedStorage() { if (typeof options.encrypt !== 'function' || typeof options.decrypt !== 'function') throw error('Brak bezpiecznego magazynu systemowego; nie zapisano sekretów.'); }
  async function read() {
    protectedStorage();
    try { const data = JSON.parse(await options.decrypt(await fs.readFile(file))); if (data.schema !== 1 || !Array.isArray(data.connectors)) throw error('Uszkodzona konfiguracja integracji.'); return data; }
    catch (e) { if (e.code === 'ENOENT') return { schema: 1, connectors: [] }; throw error('Nie można odczytać chronionej konfiguracji integracji.'); }
  }
  const summary = c => ({ id: c.id, kind: c.kind, label: c.label, baseUrl: c.baseUrl, configured: true, local: c.allowLocal, authentication: c.token ? 'configured' : 'none', publicTopicConsent: c.publicTopicConsent === true });
  async function list() { return (await read()).connectors.map(summary); }
  async function modify(fn) {
    const result = mutations.then(async () => {
      const data = await read(), result = fn(data);
      await fs.mkdir(options.directory, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${nodeCrypto.randomUUID()}.tmp`;
      try {
        const handle = await fs.open(tmp, 'wx', 0o600);
        try { await handle.writeFile(await options.encrypt(JSON.stringify(data))); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(tmp, file);
        const parent = await fs.open(options.directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
      } catch (error) { await fs.rm(tmp, { force: true }).catch(() => {}); throw error; }
      return result;
    });
    mutations = result.catch(() => {}); return result;
  }
  async function configure(input, context = {}) {
    if (context.trustedUserAction !== true) throw error('Integrację konfiguruje właściciel.', 'APPROVAL_REQUIRED');
    if (!['changedetection', 'ntfy'].includes(input.kind) || !bounded(input.label, 100)) throw error('Podaj rodzaj i nazwę integracji.');
    const config = { id: nodeCrypto.randomUUID(), kind: input.kind, label: input.label, baseUrl: baseUrl(input.baseUrl, input.allowLocal === true), allowLocal: input.allowLocal === true };
    if (input.token) { if (!bounded(input.token, 1024)) throw error('Niepoprawny token usługi.'); config.token = input.token; }
    if (config.kind === 'ntfy') {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.topic || '')) throw error('Temat ntfy wymaga 1–64 liter, cyfr, _ lub -.');
      // Authentication does not prove topic ACL; disclosure must be explicitly confirmed either way.
      if (input.publicTopicConsent !== true) throw error('Potwierdź dostęp do tematu i zgodę na przekazanie danych alertu.', 'APPROVAL_REQUIRED');
      config.topic = input.topic; config.publicTopicConsent = true;
    }
    return modify(data => { if (data.connectors.length >= 32) throw error('Limit 32 integracji.'); data.connectors.push(config); return summary(config); });
  }
  async function remove(id, context = {}) {
    if (context.trustedUserAction !== true) throw error('Integrację usuwa właściciel.', 'APPROVAL_REQUIRED');
    // Fail closed immediately, even if persistence later reports an I/O error.
    revoked.add(id); for (const controller of active.get(id) || []) controller.abort();
    return modify(data => { const n = data.connectors.length; data.connectors = data.connectors.filter(c => c.id !== id); return { removed: n !== data.connectors.length }; });
  }
  async function get(id, kind) { const config = (await read()).connectors.find(c => c.id === id && c.kind === kind); if (!config || revoked.has(id)) throw error('Integracja nie jest skonfigurowana albo została odwołana.', 'SOURCE_AUTH'); return config; }
  function checkResponse(response, now) {
    if (response.status === 429) throw Object.assign(error('Usługa ogranicza częstotliwość.', 'RATE_LIMIT'), { retryAt: retryAfter(response.headers.get('retry-after'), now) });
    if ([401,403].includes(response.status)) throw error('Usługa wymaga poprawnej autoryzacji.', 'SOURCE_AUTH');
    if (response.status >= 300 && response.status < 400) throw error('Przekierowanie wymaga nowej konfiguracji.', 'SOURCE_BLOCKED');
    if (response.status !== 200) throw error(`Usługa zwróciła HTTP ${response.status}.`, 'SOURCE_UNAVAILABLE');
  }
  async function readSource(source, { signal, now }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.watchId || '')) throw error('Podaj UUID istniejącego watch changedetection.', 'SOURCE_FORMAT');
    const op = operation(source.connectorId, signal);
    try {
      const config = await get(source.connectorId, 'changedetection');
      op.assert();
      const params = { signal: op.controller.signal, allowLocal: config.allowLocal, headers: { ...(config.token ? { 'x-api-key': config.token } : {}) } };
      const prefix = `${config.baseUrl}api/v1/watch/${source.watchId}`;
      const metaResponse = await transport(prefix, params); checkResponse(metaResponse, now);
      if (!/^application\/json\b/i.test(metaResponse.headers.get('content-type') || '')) throw error('Metadane changedetection wymagają JSON.', 'SOURCE_FORMAT');
      let meta; try { meta = JSON.parse(await metaResponse.text()); } catch { throw error('Niepoprawne metadane changedetection.', 'SOURCE_FORMAT'); }
      if (meta.paused || meta.last_error || !Number.isFinite(meta.last_checked) || meta.last_checked <= 0) throw error('Watch jest wstrzymany, niesprawdzony albo źródło zgłasza błąd.', 'SOURCE_AUTH');
      await get(source.connectorId, 'changedetection'); op.assert();
      const response = await transport(`${prefix}/history/latest`, params); checkResponse(response, now);
      if (!/^text\/plain\b/i.test(response.headers.get('content-type') || '')) throw error('changedetection nie zwrócił tekstowego snapshotu.', 'SOURCE_FORMAT');
      const body = await response.text(); if (Buffer.byteLength(body) > 1024 * 1024) throw error('Snapshot przekracza limit.', 'SOURCE_FORMAT');
      await get(source.connectorId, 'changedetection'); op.assert();
      let page; try { page = new URL(meta.url); } catch { throw error('Watch nie ma poprawnego URL.', 'SOURCE_FORMAT'); }
      if (!['https:', 'http:'].includes(page.protocol) || page.username || page.password || page.href.length > 4096 || [...page.searchParams.keys()].some(k => /token|secret|password|api.?key|auth/i.test(k))) throw error('URL obserwowanej strony zawiera niedozwolone dane.', 'SOURCE_FORMAT');
      return { items: [{ id: source.watchId, title: String(meta.title || page.href).slice(0,1000), text: body, url: page.href, available: true, modifiedAt: nodeCrypto.createHash('sha256').update(body).digest('hex'), sourceCheckedAt: meta.last_checked * 1000 }], observedAt: now, mode: 'changedetection-text-snapshot' };
    } catch (cause) {
      if (revoked.has(source.connectorId)) throw error('Dostęp do integracji został odwołany.', 'SOURCE_AUTH');
      throw cause;
    } finally { op.finish(); }
  }
  async function createWatch(input, context = {}) {
    if (context.trustedUserAction !== true) throw error('Utworzenie watcha wymaga zgody właściciela.', 'APPROVAL_REQUIRED');
    if (!context.journal?.command || !/^[a-zA-Z0-9-]{1,100}$/.test(context.taskId || '')) throw error('Brak trwałej tożsamości zadania.', 'MISSING_CONFIGURATION');
    const spec = watchSpec(input), op = operation(spec.connectorId, context.signal);
    const key = nodeCrypto.createHash('sha256').update(JSON.stringify([context.taskId, spec.connectorId, spec.url])).digest('hex');
    const fingerprint = nodeCrypto.createHash('sha256').update(JSON.stringify(spec)).digest('hex');
    const journal = (action, extra = {}) => context.journal.command({ action, key, fingerprint, ...extra }, { trustedUserAction: true });
    const uncertain = watchId => ({ ok: false, code: 'WATCH_EFFECT_UNCERTAIN', uncertain: true, ...(watchId ? { watchId } : {}), error: 'Nie potwierdzono skutku. Sprawdź usługę przed ponowieniem; JARVIS nie wyśle ponownie POST.' });
    let dispatched = false, watchId;
    try {
      const config = await get(spec.connectorId, 'changedetection'); op.assert();
      const host = new URL(spec.url).hostname.replace(/^\[|\]$/g, '');
      const addresses = await (options.targetLookup || dns.lookup)(host, { all: true }); op.assert();
      if (!addresses.length || addresses.some(address => !publicAddress(address.address))) throw error('Adres strony rozwiązuje się do nieautoryzowanej sieci.', 'SOURCE_BLOCKED');
      const reservation = await journal('watch_reserve'); op.assert();
      const params = { signal: op.controller.signal, allowLocal: config.allowLocal, headers: { ...(config.token ? { 'x-api-key': config.token } : {}) } };
      if (!reservation.reserved) {
        watchId = reservation.operation?.watchId;
        if (!watchId || !['KNOWN_ID', 'VERIFIED'].includes(reservation.operation?.state)) return uncertain();
      } else {
        dispatched = true;
        const response = await transport(`${config.baseUrl}api/v1/watch`, { ...params, method: 'POST', headers: { ...params.headers, 'content-type': 'application/json' }, body: JSON.stringify({ url: spec.url, title: spec.title, paused: true, notification_muted: true, time_between_check: { seconds: spec.intervalMs / 1000 }, time_between_check_use_default: false }) });
        if (response.status !== 201 || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) return uncertain();
        let ack; try { ack = JSON.parse(await response.text()); } catch { return uncertain(); }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ack?.uuid || '')) return uncertain();
        watchId = ack.uuid;
        await journal('watch_record', { watchId, state: 'KNOWN_ID' });
        op.assert();
      }
      const response = await transport(`${config.baseUrl}api/v1/watch/${watchId}`, params); op.assert();
      if (response.status !== 200 || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) return uncertain(watchId);
      let watch; try { watch = JSON.parse(await response.text()); } catch { return uncertain(watchId); }
      const time = watch?.time_between_check;
      const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'];
      const validTime = time && typeof time === 'object' && !Array.isArray(time) && units.every(unit => time[unit] == null || (Number.isSafeInteger(time[unit]) && time[unit] >= 0));
      const seconds = validTime && units.reduce((sum, unit, i) => sum + (time[unit] || 0) * [604800, 86400, 3600, 60, 1][i], 0);
      if (watch?.url !== spec.url || watch?.title !== spec.title || watch?.paused !== true || watch?.notification_muted !== true || watch?.time_between_check_use_default !== false || seconds !== spec.intervalMs / 1000) return uncertain(watchId);
      op.assert(); await journal('watch_record', { watchId, state: 'VERIFIED' }); op.assert();
      return { ok: true, watchId, source: { kind: 'changedetection', connectorId: spec.connectorId, watchId }, verified: true, paused: true, notificationsMuted: true, notice: 'Watch utworzono w pauzie i z wyciszonymi powiadomieniami usługi. Nie monitoruje jeszcze strony; uruchomienie wymaga osobnej obsługi i zgody.' };
    } catch (cause) {
      if (dispatched || watchId) return uncertain(watchId);
      throw cause;
    } finally { op.finish(); }
  }
  async function notify(event, { signal } = {}) {
    if (signal?.aborted) return { accepted: false, retryable: false };
    let config;
    try { config = await get(event.connectorId, 'ntfy'); } catch { return { accepted: false, retryable: false }; }
    if (signal?.aborted) return { accepted: false, retryable: false };
    const op = operation(event.connectorId, signal), controller = op.controller;
    const timeout = setTimeout(() => controller.abort(), 12000); timeout.unref?.();
    try {
      try { await get(event.connectorId, 'ntfy'); op.assert(); } catch { return { accepted: false, retryable: false }; }
      const message = `Cel: ${event.goalId}\nZdarzenie: ${event.id}\n${event.title}\n${event.total == null ? 'Koszt niepotwierdzony' : `${event.total} ${event.currency || ''}`}\n${event.url}\nSprawdzono: ${new Date(event.observedAt).toISOString()}`;
      const response = await transport(config.baseUrl, { method: 'POST', signal: controller.signal, allowLocal: config.allowLocal, headers: { 'content-type': 'application/json', ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) }, body: JSON.stringify({ topic: config.topic, title: 'JARVIS — wynik monitora', message }) });
      if (controller.signal.aborted) return {};
      if (response.status === 429) return { accepted: false, retryable: true, retryAt: retryAfter(response.headers.get('retry-after'), Date.now()) };
      if ([400,401,403,404,413].includes(response.status)) return { accepted: false, retryable: false };
      if (response.status !== 200) return {}; // server may already have committed: uncertain, no blind retry
      let ack; try { ack = JSON.parse(await response.text()); } catch { return {}; }
      if (controller.signal.aborted) return {};
      return ack.event === 'message' && typeof ack.id === 'string' && ack.id.length > 0 && ack.topic === config.topic ? { accepted: true, providerId: ack.id } : {};
    } finally { clearTimeout(timeout); op.finish(); }
  }
  return { configure, list, remove, readSource, createWatch, notify, isRevoked: id => revoked.has(id) };
}
module.exports = { createMonitorConnectors, baseUrl, request, watchSpec };
