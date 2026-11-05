/* global localStorage */
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const { webcrypto, createHash } = require('node:crypto');
const { newRun, root, path, fs, pause, ownedProcess, stop, which } = require('./common.cjs');
const { freePort, send, stored, dismissSetup } = require('./agent-smoke.cjs');
async function verifyLocalChecks({ run, page, restart, prefix = 'local', level = 'web Chromium, no model' }) {
      if (await page.evaluate(() => !JSON.parse(localStorage.getItem('jarvis.settings.v2') || '{}').ollamaUrl)) await dismissSetup(page);
      const title = `Przekazanie ${prefix} ${run.id} — Zażółć gęślą jaźń`;
      await send(page, `Dodaj zadanie: ${title}`);
      await page.waitForFunction(title => JSON.parse(localStorage.getItem('jarvis.data.v2') || '{}').tasks?.filter(t => t.title === title).length === 1, title);
      await page.locator('.bubble.assistant').filter({ hasText: title }).waitFor();
      await page.getByRole('button', { name: 'Nowy', exact: true }).click();
      await page.locator('.app.interface-modern').waitFor();
      const before = await stored(page); run.write(`${prefix}-before-restart.json`, before);
      page = await restart();
      await page.locator('.boot').waitFor({ state: 'hidden' });
      if (await page.evaluate(() => !JSON.parse(localStorage.getItem('jarvis.settings.v2') || '{}').ollamaUrl)) await dismissSetup(page);
      await page.locator('.app.interface-modern').waitFor();
      const after = await stored(page);
      const settings = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('jarvis.settings.v2') || '{}');
        return { interfaceMode: s.interfaceMode, provider: s.provider, ollamaUrl: s.ollamaUrl || '' };
      });
      run.write(`${prefix}-after-restart.json`, { ...after, settings });
      const tasks = after.data.tasks?.filter(t => t.title === title) || [];
      const audits = after.data.audit?.filter(a => a.tool === 'add_task' && a.status === 'ok' && JSON.parse(a.input).title === title) || [];
      if (tasks.length !== 1 || audits.length !== 1 || tasks[0].id !== before.data.tasks.find(t => t.title === title)?.id || !after.chats.some(c => c.messages.some(m => m.role === 'assistant' && m.text.includes(title))) || settings.interfaceMode !== 'modern') throw Error('Local task, settings, audit or history failed after process restart');
      await page.getByRole('button', { name: 'STOP — zatrzymaj działania', exact: true }).waitFor();
      await page.screenshot({ path: path.join(run.dir, `${prefix}-restarted.png`) });
      run.record({ id: `independent-${prefix}`, level, status: 'PASS', detail: 'Normal composer, Polish task, UI setting switch, full process restart, same task ID, one audit and saved history. License remained required. Not scenario A/B/C proof.', evidence: [`${prefix}-before-restart.json`, `${prefix}-after-restart.json`, `${prefix}-restarted.png`] });

  return page;
}
async function runLicenseUi({ run = newRun('license-ui'), localChecks = false, chromiumPath, registerCleanup = () => {} } = {}) {
  let server, context;
  let cleaned = false;
  const cleanup = async () => { if (cleaned) return; cleaned = true; await context?.close().catch(() => {}); await stop(server); };
  registerCleanup(cleanup);
  try {
    // Ephemeral test issuer only; the user's production pair is created on their own machine.
    const { initIssuer } = await import(pathToFileURL(path.join(root, 'scripts/license.mjs')).href);
    const issuer = await initIssuer({ 'key-dir': path.join(run.dir, 'test-issuer'), 'public-file': path.join(run.dir, 'public.json') });
    const priv = JSON.parse(fs.readFileSync(issuer.privateFile, 'utf8'));
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    server = ownedProcess(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, JARVIS_LICENSE_REQUIRED: 'true', JARVIS_LICENSE_PUBLIC_KEY_FILE: issuer.publicFile, JARVIS_LICENSE_URL: '', JARVIS_LICENSE_STRICT: 'false', APP_BUILD: run.id } }, run, 'vite.log');
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.qaError || server.exitCode !== null) throw Error('Test server failed; see vite.log');
      try { ready = (await fetch(origin, { signal: AbortSignal.timeout(500) })).ok; } catch { /* bounded readiness */ }
      if (ready) break; await pause(100);
    }
    if (!ready) throw Error('Vite startup timeout');
    async function openProfile() {
      context = await chromium.launchPersistentContext(path.join(run.dir, 'browser-profile'), { executablePath: chromiumPath || process.env.QA_CHROMIUM || which('chromium') || which('chromium-browser'), headless: true, chromiumSandbox: true, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        deniedOrigins.push(url.origin); return route.abort();
      });
      const next = context.pages()[0]; next.setDefaultTimeout(20000); await next.goto(origin); return next;
    }
    const deniedOrigins = [];
    let page = await openProfile();
    await page.getByRole('button', { name: /Panel właściciela — klucze APK/ }).click();
    const other = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const wrongFile = path.join(run.dir, 'wrong-test-issuer.json');
    fs.writeFileSync(wrongFile, JSON.stringify(await webcrypto.subtle.exportKey('jwk', other.privateKey)), { mode: 0o600 });
    await page.getByLabel('Importuj klucz wystawcy').setInputFiles(wrongFile);
    await page.getByText(/Ten klucz nie potwierdza własności/).waitFor();
    await page.getByLabel('Importuj klucz wystawcy').setInputFiles(issuer.privateFile);
    await page.getByLabel('Właściciel licencji APK').fill('QA Zażółć gęślą jaźń');
    await page.getByLabel('Ważność licencji w dniach').fill('30');
    await page.getByRole('button', { name: /Generuj klucz licencyjny APK/ }).click();
    const output = page.getByLabel('Wygenerowany klucz licencyjny APK'); await output.waitFor();
    const token = await output.inputValue(), [data, sig] = token.split('.');
    const publicJwk = JSON.parse(fs.readFileSync(issuer.publicFile, 'utf8'));
    const publicKey = await webcrypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, Buffer.from(sig, 'base64url'), Buffer.from(data))) throw Error('Independent signature verification failed');
    const payload = JSON.parse(Buffer.from(data, 'base64url'));
    if (payload.n !== 'QA Zażółć gęślą jaźń' || payload.exp - payload.iat !== 30 * 86400000) throw Error('Wrong owner or expiry');
    if ((await page.evaluate(() => JSON.stringify(localStorage))).includes(priv.d)) throw Error('Private scalar leaked into browser storage');
    await output.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(run.dir, 'issued-license.png') });
    await page.getByRole('button', { name: 'Zamknij', exact: true }).last().click();
    await page.getByPlaceholder('Klucz licencyjny…', { exact: true }).fill(token);
    await page.getByRole('button', { name: 'Aktywuj', exact: true }).click();
    await page.getByRole('button', { name: 'Aktywuj', exact: true }).waitFor({ state: 'hidden' });
    if (await page.evaluate(() => localStorage.getItem('jarvis.license.v1')) !== token) throw Error('Activation did not persist the issued token');
    if (localChecks) await page.evaluate(() => localStorage.setItem('jarvis.onboarded.v1', '1'));
    await page.reload(); await page.locator('.boot').waitFor({ state: 'hidden' });
    if (await page.getByRole('button', { name: 'Aktywuj', exact: true }).count()) throw Error('Reload lost activation');
    if (localChecks) page = await verifyLocalChecks({ run, page, restart: async () => { await context.close(); context = null; return openProfile(); } });
    run.write('verification.json', { run_id: run.id, level: 'B: real license UI and WebCrypto, not agent autonomy or native APK', license_required: true, test_issuer: true, wrong_issuer_rejected: true, independent_signature_valid: true, payload, token_sha256: createHash('sha256').update(token).digest('hex'), private_key_persisted: false, activation_persisted: true, reload_activated: true, denied_origins: [...new Set(deniedOrigins)] });
    run.record({ id: 'license-issue-activate', level: 'B', status: 'PASS', detail: 'Normal licensed gate → owner import proof → real local signature → independent verification → normal activation → reload. No license bypass.', evidence: ['verification.json', 'issued-license.png'] });
    return { ok: true, issuer, token };
  } catch (e) {
    const failedPage = context?.pages()[0];
    if (failedPage) {
      await failedPage.screenshot({ path: path.join(run.dir, 'independent-failure.png') }).catch(() => {});
      await failedPage.locator('body').innerText().then(text => run.write('independent-failure.txt', text)).catch(() => {});
    }
    run.write('error.txt', e.stack || e.message); run.record({ id: 'license-issue-activate', level: 'B', status: 'FAIL', detail: e.message, evidence: ['error.txt', 'vite.log'] });
    return { ok: false };
  } finally { await cleanup(); }
}
module.exports = { runLicenseUi, verifyLocalChecks };
if (require.main === module) {
  const run = newRun('license-ui');
  let cleanup = async () => {};
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { run.record({ id: 'interrupted', level: 'runner', status: 'NOT_RUN', detail: signal }); run.finish(); void cleanup().finally(() => process.exit(130)); });
  runLicenseUi({ run, registerCleanup: fn => { cleanup = fn; } }).then(result => { run.finish(); process.exitCode = result.ok ? 0 : 1; });
}
