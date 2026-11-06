// Bounded Playwright adapter; it is a tool transport, not another planner.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const dns = require('node:dns/promises');
const http = require('node:http');
const https = require('node:https');
const { isPublicIPv4 } = require('./public-page.cjs');
const MAX_DOWNLOAD = 20 * 1024 * 1024;
const ACTIONS = new Set(['read', 'interact', 'download']);
const INTERACTION_LIMITS = { mainFrameOnly: true, backgroundSubmissions: false, subframes: false, redirects: false };
const error = (message, code = 'BROWSER_BLOCKED') => Object.assign(new Error(message), { code });
const uncertainOutcome = () => ({ ok: false, code: 'BROWSER_EFFECT_UNCONFIRMED', uncertain: true, actionDispatched: true, externalEffectConfirmed: false, error: 'Skutek zatwierdzonego żądania jest niepotwierdzony i mógł już wystąpić. Nie ponawiaj operacji bez niezależnego sprawdzenia.', notice: 'Nie cofnięto operacji wysłanej przed przerwaniem lub zablokowaniem odpowiedzi.' });
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(error('Działanie przeglądarki anulowano.', 'CANCELLED'));
  let abort;
  return Promise.race([promise, new Promise((_, reject) => { abort = () => reject(error('Działanie przeglądarki anulowano.', 'CANCELLED')); signal.addEventListener('abort', abort, { once: true }); })])
    .finally(() => signal.removeEventListener('abort', abort));
}
function validGrant(grant) {
  try { return grant && webUrl(grant.origin).origin === grant.origin && Array.isArray(grant.actions) && grant.actions.includes('read') && grant.actions.every(a => ACTIONS.has(a)) && typeof grant.allowLocal === 'boolean' && (grant.expiresAt === null || Number.isFinite(grant.expiresAt)); } catch { return false; }
}
function webUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) throw error('Niepoprawny adres strony.');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw error('Wymagany HTTP/HTTPS bez hasła w adresie.');
  if ([...url.searchParams.keys()].some(k => /token|secret|password|api.?key/i.test(k))) throw error('Nie przekazuj sekretów w adresach narzędzi przeglądarki.');
  return url;
}
function validSelector(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 500 || /[\0\r\n]/.test(raw) || /^(?:xpath|js)=/i.test(raw)) throw error('Wymagany krótki selektor CSS/tekstowy.');
  return raw;
}
function createBrowserSession(options) {
  if (!path.isAbsolute(options?.directory || '') || !path.isAbsolute(options?.downloadDirectory || '')) throw error('Wymagane oddzielne katalogi przeglądarki i pobrań.');
  const stateFile = path.join(options.directory, 'grants-v1.json');
  const now = options.now || Date.now;
  let browser, context, page, grants = [], epoch = 0, busy = false, current = null, networkMode = 'read', pendingLaunch = null;
  let loadPromise;
  const lookup = options.lookup || dns.lookup;
  const audit = [];
  const record = (action, result, detail) => { audit.push({ at: now(), action, result, detail }); if (audit.length > 200) audit.shift(); };
  async function load() {
    if (!loadPromise) loadPromise = (async () => {
      await fs.mkdir(options.directory, { recursive: true, mode: 0o700 });
      try { const state = JSON.parse(await fs.readFile(stateFile, 'utf8')); if (state.schemaVersion !== 1 || !Array.isArray(state.grants) || state.grants.length > 100 || !state.grants.every(validGrant)) throw error('Uszkodzony magazyn zgód przeglądarki.'); grants = state.grants; }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    })();
    return loadPromise;
  }
  async function save() {
    const temporary = `${stateFile}.${nodeCrypto.randomUUID()}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, grants })); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, stateFile);
  }
  function grantFor(url, action) { return grants.find(g => g.origin === url.origin && g.actions.includes(action) && (!g.expiresAt || g.expiresAt > now())); }
  async function approvedAddress(url, action, candidate) {
    const grant = candidate || grantFor(url, action);
    if (!grant) throw error('Brak zakresowej zgody na tę stronę lub działanie.', 'APPROVAL_REQUIRED');
    let timeout;
    const addresses = await Promise.race([lookup(url.hostname, { family: 4, all: true }), new Promise((_, reject) => { timeout = setTimeout(() => reject(error('Timeout DNS.')), 8000); timeout.unref?.(); })]).finally(() => clearTimeout(timeout));
    if (!addresses.length || addresses.some(a => !isPublicIPv4(a.address) && !grant.allowLocal)) throw error('Źródło rozwiązuje się do nieautoryzowanego adresu lokalnego.');
    return addresses[0].address;
  }
  async function stop() {
    epoch++;
    current?.controller.abort();
    const owned = browser, starting = pendingLaunch; browser = context = page = null;
    if (owned) await owned.close().catch(() => {});
    if (starting) await starting.then(created => created.close()).catch(() => {});
    record('stop', 'CANCELLED', 'Zamknięto wyłącznie przeglądarkę JARVIS-a; wcześniejszy skutek zewnętrzny wymaga weryfikacji.');
    return { ok: true, stopped: true };
  }
  async function ensureSession(operation) {
    if (browser) return;
    const assertCurrent = () => { if (operation.epoch !== epoch || operation.controller.signal.aborted) throw error('Start przeglądarki anulowano.', 'CANCELLED'); };
    assertCurrent();
    let executablePath = options.executablePath;
    if (!executablePath) for (const candidate of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) { try { await fs.access(candidate); executablePath = candidate; break; } catch { /* next installed candidate */ } }
    if (!executablePath) throw error('Brak skonfigurowanej przeglądarki Chromium. Ustaw JARVIS_BROWSER_EXECUTABLE; niczego nie pobrano.', 'MISSING_CONFIGURATION');
    const mappings = [];
    for (const grant of grants.filter(g => !g.expiresAt || g.expiresAt > now())) { const url = webUrl(grant.origin); mappings.push(`MAP ${url.hostname} ${await abortable(approvedAddress(url, 'read'), operation.controller.signal)}`); }
    assertCurrent();
    const { chromium } = require('playwright-core');
    const launching = (options.launch || chromium.launch.bind(chromium))({ executablePath, headless: options.headless ?? !(process.env.DISPLAY || process.env.WAYLAND_DISPLAY), chromiumSandbox: true,
      args: [`--host-resolver-rules=${mappings.join(', ')}`, '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'], timeout: 15000 });
    pendingLaunch = launching;
    let launched;
    try { launched = await launching; } finally { if (pendingLaunch === launching) pendingLaunch = null; }
    try { assertCurrent(); } catch (e) { await launched.close(); throw e; }
    browser = launched;
    try {
    const createdContext = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', ignoreHTTPSErrors: false });
    assertCurrent(); context = createdContext;
    networkMode = 'read';
    await context.route('**/*', async route => {
      try {
        if (browser !== launched) return route.abort('blockedbyclient').catch(() => {});
        const request = route.request(), url = webUrl(request.url());
        if (!page || request.frame() !== page.mainFrame()) {
          if (current) current.blockedRequestCount = (current.blockedRequestCount || 0) + 1;
          record('subframe-request', 'BLOCKED', url.origin); return route.abort('blockedbyclient');
        }
        if (!grantFor(url, 'read')) return route.abort('blockedbyclient');
        if (networkMode !== 'read' || !['GET', 'HEAD'].includes(request.method())) {
          const operation = current;
          const body = request.postData() || '';
          if (!request.isNavigationRequest()) {
            if (operation) operation.blockedRequestCount = (operation.blockedRequestCount || 0) + 1;
            record('background-request', 'BLOCKED', `${request.method()} ${url.origin}`);
            return route.abort('blockedbyclient');
          }
          if (!operation || operation.action !== 'click' || !operation.navigationArmed || operation.navigationClaimed || request.redirectedFrom() || operation.controller.signal.aborted || !grantFor(url, 'interact') || !options.approveMutation || Buffer.byteLength(body) > 8192 || /multipart\//i.test(request.headers()['content-type'] || '')) {
            if (operation) { operation.navigationPolicyBlocked = true; operation.blockedRequestCount++; }
            record('navigation-request', 'BLOCKED', url.origin); return route.abort('blockedbyclient');
          }
          operation.navigationClaimed = true; // Reserve before native approval; no second request may inherit this click.
          const decision = await abortable(Promise.resolve(options.approveMutation({ url: url.href, method: request.method(), bodyPreview: body, bodyHash: nodeCrypto.createHash('sha256').update(`${request.method()}\n${url.href}\n${body}`).digest('hex') })), operation.controller.signal);
          if (decision !== true) {
            operation.navigationDenied = true; operation.blockedRequestCount++;
            record('external-request', 'DENIED', `${request.method()} ${url.origin}`);
            return route.abort('blockedbyclient');
          }
          if (current !== operation || operation.epoch !== epoch || operation.controller.signal.aborted || !grantFor(url, 'interact')) return route.abort('blockedbyclient');
          operation.navigationApproved = true;
          operation.approvedNavigation = { url: request.url(), method: request.method() };
          record('external-request', 'AUTHORIZED', `${request.method()} ${url.origin}`);
        }
        return route.continue();
      } catch { return route.abort('blockedbyclient').catch(() => {}); }
    });
    assertCurrent();
    await context.routeWebSocket('**/*', ws => ws.close());
    assertCurrent();
    context.on('page', created => { if (page && created !== page) void created.close(); });
    const createdPage = await context.newPage();
    assertCurrent(); page = createdPage;
    // Playwright routes see only the first URL of an HTTP redirect chain. Pause
    // real Chromium responses before processing Location; retain its DNS pinning,
    // TLS and cookie jar instead of forwarding traffic through Node.
    const responseGuard = await context.newCDPSession(page);
    responseGuard.on('Fetch.requestPaused', async event => {
      if (browser !== launched) return; // Late events from a closed session cannot affect a new task.
      try {
        if (event.responseErrorReason || (event.responseStatusCode >= 300 && event.responseStatusCode < 400 && event.responseStatusCode !== 304)) {
          if (current?.navigationApproved && event.resourceType === 'Document' && event.request.url === current.approvedNavigation?.url && event.request.method === current.approvedNavigation?.method) current.unconfirmedEffect = true;
          record('redirect-or-failed-response', 'BLOCKED', webUrl(event.request.url).origin);
          await responseGuard.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
        } else await responseGuard.send('Fetch.continueResponse', { requestId: event.requestId });
      } catch {
        if (browser === launched) { record('response-guard', 'FAILED_CLOSED', 'Zamknięto własną sesję po błędzie ochrony odpowiedzi.'); await stop(); }
      }
    });
    await responseGuard.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
    assertCurrent();
    page.setDefaultTimeout(10000);
    page.on('download', download => { void download.cancel(); });
    } catch (e) {
      if (browser === launched) browser = context = page = null;
      await launched.close().catch(() => {}); throw e;
    }
  }
  async function target(selector) {
    if (!page || page.isClosed()) throw error('Najpierw otwórz stronę.');
    const url = webUrl(page.url());
    if (!grantFor(url, 'interact')) throw error('Brak zgody na interakcję z tą stroną.', 'APPROVAL_REQUIRED');
    const locator = page.locator(validSelector(selector));
    if (await locator.count() !== 1) throw error('Selektor musi wskazywać dokładnie jeden aktualny element.');
    return locator;
  }
  async function download(selector, operation) {
    const locator = page.locator(validSelector(selector));
    if (await locator.count() !== 1) throw error('Link pobrania jest niejednoznaczny.');
    const href = await locator.getAttribute('href');
    if (!href) throw error('Pobranie wymaga linku HTTP/HTTPS.');
    const url = webUrl(new URL(href, page.url()).href);
    const address = await approvedAddress(url, 'download');
    if (operation.controller.signal.aborted || operation.epoch !== epoch) throw error('Anulowano pobranie.');
    // Anchor creation and writes to directory descriptors; never follow a download
    // symlink or a path swapped while the response is in flight.
    if (process.platform !== 'linux') throw error('Bezpieczne pobieranie przez ten adapter wymaga linuksowego katalogu /proc/self/fd.', 'PLATFORM_UNAVAILABLE');
    const parentPath = path.dirname(options.downloadDirectory);
    if (await fs.realpath(parentPath) !== path.resolve(parentPath)) throw error('Katalog pobrań nie może prowadzić przez dowiązania symboliczne.');
    const parentHandle = await fs.open(parentPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let directoryHandle;
    try {
      const anchoredDirectory = `/proc/self/fd/${parentHandle.fd}/${path.basename(options.downloadDirectory)}`;
      await fs.mkdir(anchoredDirectory, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
      if (await fs.realpath(options.downloadDirectory) !== path.resolve(options.downloadDirectory)) throw error('Katalog pobrań nie może prowadzić przez dowiązania symboliczne.');
      directoryHandle = await fs.open(anchoredDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    } finally { await parentHandle.close(); }
    const directoryStat = await directoryHandle.stat();
    const name = `${nodeCrypto.randomUUID()}-${path.basename(url.pathname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'download.bin'}`;
    const finalPath = path.join(options.downloadDirectory, name), anchoredPath = `/proc/self/fd/${directoryHandle.fd}/${name}`, temporary = anchoredPath + '.part';
    let handle;
    try { handle = await fs.open(temporary, 'wx', 0o600); } catch (e) { await directoryHandle.close(); throw e; } let size = 0; const digest = nodeCrypto.createHash('sha256');
    try {
      const cookies = await context.cookies(url.href);
      await new Promise((resolve, reject) => {
        const req = (url.protocol === 'https:' ? https : http).get(url, { signal: operation.controller.signal, timeout: 15000,
          headers: { cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '), accept: 'application/octet-stream,*/*;q=0.5' },
          lookup: (_h, opts, cb) => opts?.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4),
        }, async response => {
          try {
            if (response.statusCode !== 200 || /text\/html/i.test(String(response.headers['content-type'] || ''))) throw error('Pobranie zwróciło przekierowanie, błąd lub stronę HTML.');
            if (Number(response.headers['content-length'] || 0) > MAX_DOWNLOAD) throw error('Plik przekracza limit 20 MiB.');
            for await (const chunk of response) {
              size += chunk.length;
              if (size > MAX_DOWNLOAD || operation.epoch !== epoch || operation.controller.signal.aborted || !grantFor(url, 'download')) throw error('Pobranie przerwane lub przekracza limit.');
              digest.update(chunk); await handle.write(chunk);
            }
            if (!size) throw error('Pobrano pusty plik.');
            resolve();
          } catch (e) { response.destroy(); reject(e); }
        });
        req.on('timeout', () => req.destroy(error('Timeout pobrania.'))); req.on('error', reject);
      });
      if (operation.epoch !== epoch || operation.controller.signal.aborted) throw error('Pobranie anulowano.');
      const visible = await fs.stat(options.downloadDirectory);
      if (visible.dev !== directoryStat.dev || visible.ino !== directoryStat.ino || await fs.realpath(options.downloadDirectory) !== path.resolve(options.downloadDirectory)) throw error('Katalog pobrań zmienił się podczas operacji.');
      await handle.sync(); await handle.close(); await fs.rename(temporary, anchoredPath);
      return { ok: true, path: finalPath, bytes: size, sha256: digest.digest('hex') };
    } catch (e) { await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); throw e; }
    finally { await directoryHandle.close(); }
  }
  async function command(request, execution = {}) {
    await load();
    if (request?.action === 'stop') return stop();
    if (request?.action === 'status') return { ok: true, active: !!browser, busy, starting: !!pendingLaunch, interactionLimits: INTERACTION_LIMITS, grants: grants.map(g => ({ ...g })), page: page && !page.isClosed() ? page.url() : null, audit: [...audit], browserDownloadAutomatic: false, profile: 'isolated ephemeral context; no imported user cookies' };
    if (request?.action === 'grant') {
      if (!execution.trustedUserAction) throw error('Zakres przeglądarki zatwierdza użytkownik.', 'APPROVAL_REQUIRED');
      const url = webUrl(request.origin);
      if (url.pathname !== '/' || url.search || url.hash) throw error('Zgoda wymaga jawnego origin: protokół, host i port.');
      const actions = [...new Set(request.actions || [])];
      if (!actions.includes('read') || actions.some(a => !ACTIONS.has(a))) throw error('Niepoprawny zakres działań.');
      if (request.expiresAt !== undefined && (!Number.isFinite(request.expiresAt) || request.expiresAt <= now())) throw error('Niepoprawny termin zgody.');
      const grant = { origin: url.origin, actions, allowLocal: request.allowLocal === true, expiresAt: request.expiresAt || null, approvedAt: now() };
      await approvedAddress(url, 'read', grant);
      await stop(); // Old browser must close before new scopes become visible.
      const previous = grants;
      grants = [...grants.filter(g => g.origin !== url.origin), grant];
      try { await save(); } catch (e) { grants = previous; throw e; }
      return { ok: true, grant };
    }
    if (request?.action === 'revoke') {
      const origin = webUrl(request.origin).origin;
      grants = grants.filter(g => g.origin !== origin); await save(); await stop(); return { ok: true, revoked: origin };
    }
    if (!['open', 'read', 'fill', 'click', 'download'].includes(request?.action)) throw error('Nieobsługiwane działanie przeglądarki.');
    if (busy) throw error('Przeglądarka jest zajęta przez inne działanie.');
    const operation = { epoch, action: request.action, controller: new AbortController(), navigationArmed: false, navigationClaimed: false, navigationApproved: false, navigationDenied: false, navigationPolicyBlocked: false, unconfirmedEffect: false, blockedRequestCount: 0 };
    if (execution.signal?.aborted) throw error('Anulowano działanie.');
    const abort = () => { operation.controller.abort(); void stop(); };
    execution.signal?.addEventListener('abort', abort, { once: true });
    busy = true; current = operation;
    const timeout = setTimeout(abort, 30000); timeout.unref?.();
    try {
      await ensureSession(operation);
      if (operation.epoch !== epoch || operation.controller.signal.aborted) throw error('Anulowano działanie.');
      let result;
      if (request.action === 'open') {
        const url = webUrl(request.url); await abortable(approvedAddress(url, 'read'), operation.controller.signal);
        if (operation.epoch !== epoch || operation.controller.signal.aborted) throw error('Nawigację anulowano.');
        if (networkMode !== 'read') {
          // A fragment navigation must never re-enable requests from a filled old page.
          // Close its entire context while draft traffic is still blocked, then reset.
          const previous = browser; browser = context = page = null;
          if (previous) await previous.close();
          await ensureSession(operation);
        }
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (!grantFor(webUrl(page.url()), 'read')) throw error('Przekierowanie poza dozwolony zakres.');
        result = { ok: true, url: page.url(), title: await page.title() };
      } else if (request.action === 'read') {
        if (!page || !grantFor(webUrl(page.url()), 'read')) throw error('Brak aktualnej autoryzowanej strony.');
        const snapshot = await page.locator('body').evaluate(body => ({ text: (body.innerText || '').slice(0, 24000),
          elements: [...body.querySelectorAll('a,input,textarea,select,button')].slice(0, 120).map(el => ({ tag: el.tagName.toLowerCase(), id: el.id, name: el.getAttribute('name'), role: el.getAttribute('role'), type: el.getAttribute('type'), label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 160), href: el.getAttribute('href') })) }));
        result = { ok: true, url: page.url(), title: await page.title(), untrustedPageData: snapshot };
      } else if (request.action === 'fill') {
        if (typeof request.value !== 'string' || request.value.length > 8000) throw error('Niepoprawny tekst formularza.');
        const locator = await target(request.selector);
        if (await locator.getAttribute('type') === 'password') throw error('Hasło wprowadź samodzielnie w przeglądarce.');
        networkMode = 'draft';
        await locator.fill(request.value); result = { ok: true, draft: true, verifiedValue: await locator.inputValue() === request.value };
      } else if (request.action === 'click') {
        const locator = await target(request.selector);
        // Only one main-frame navigation can request approval, including GET query data.
        // Background fetch/XHR/beacons cannot inherit this click's authorization.
        networkMode = 'click';
        operation.navigationArmed = true;
        await locator.click({ timeout: 10000 });
        // Click completion can precede Playwright's route callback. Wait for
        // already-dispatched network activity to settle before reporting it.
        // networkidle may still describe the old page immediately after click,
        // so give Chromium time to deliver pending request events first.
        // A busy page is an unconfirmed result, not a successful submission.
        try {
          await abortable(page.waitForTimeout(500), operation.controller.signal);
          await abortable(page.waitForLoadState('networkidle', { timeout: 2000 }), operation.controller.signal);
        }
        catch (cause) {
          if (cause?.name !== 'TimeoutError') throw cause;
          result = { ...uncertainOutcome(), error: 'Nie potwierdzono wyniku kliknięcia: żądania strony nadal trwają. Sprawdź rezultat przed ponowieniem.' };
        }
        const ok = !operation.navigationDenied && !operation.navigationPolicyBlocked && (!operation.blockedRequestCount || operation.navigationApproved);
        const notice = operation.navigationDenied ? 'Użytkownik odmówił zgody. Żądanie nie zostało wysłane.'
          : operation.navigationPolicyBlocked ? 'Żądanie nawigacji wykracza poza dozwolony zakres tej operacji i zostało zablokowane.'
          : 'Zablokowano żądania w tle. Wysyłka przez fetch/XHR oraz formularze w ramkach wymagają innego adaptera; nie potwierdzono ich wykonania.';
        result = result || (operation.unconfirmedEffect ? uncertainOutcome() : { ok, actionDispatched: true, url: page.url(), externalEffectConfirmed: false,
          blockedRequestCount: operation.blockedRequestCount, interactionLimits: INTERACTION_LIMITS,
          ...(operation.navigationDenied ? { code: 'APPROVAL_DENIED' } : {}),
          ...(operation.blockedRequestCount ? { notice, ...(!ok ? { error: notice } : {}) } : {}) });
      } else result = await download(request.selector, operation);
      if (operation.epoch !== epoch || operation.controller.signal.aborted) throw error('Odrzucono spóźniony wynik przeglądarki.');
      record(request.action, result.uncertain ? 'UNCONFIRMED' : result.ok === false ? 'BLOCKED' : 'COMPLETED', result.url ? new URL(result.url).origin : '');
      return result;
    } catch (e) {
      if (operation.navigationDenied && !operation.navigationApproved) {
        record(request.action, 'BLOCKED', 'APPROVAL_DENIED');
        return { ok: false, code: 'APPROVAL_DENIED', actionDispatched: true, externalEffectConfirmed: false, error: 'Użytkownik odmówił zgody. Żądanie nie zostało wysłane.' };
      }
      record(request.action, 'UNCONFIRMED', operation.navigationApproved ? 'BROWSER_EFFECT_UNCONFIRMED' : e.code || 'BROWSER_ERROR');
      if (operation.navigationApproved) return uncertainOutcome();
      throw e;
    }
    finally { clearTimeout(timeout); execution.signal?.removeEventListener('abort', abort); if (current === operation) current = null; busy = false; }
  }
  return { command, stop, close: stop };
}
module.exports = { createBrowserSession, webUrl };
