/* global localStorage */
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const { webcrypto, createHash } = require('node:crypto');
const { newRun, root, path, fs, pause, ownedProcess, stop, which } = require('./common.cjs');
const { freePort } = require('./agent-smoke.cjs');
(async () => {
  const run = newRun('license-ui'); let server, context;
  let cleaned = false;
  const cleanup = async () => { if (cleaned) return; cleaned = true; await context?.close().catch(() => {}); await stop(server); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
  try {
    // Ephemeral test issuer only; the user's production pair is created on their own machine.
    const { initIssuer } = await import(pathToFileURL(path.join(root, 'scripts/license.mjs')).href);
    const issuer = await initIssuer({ 'key-dir': path.join(run.dir, 'test-issuer'), 'public-file': path.join(run.dir, 'public.json') });
    const priv = JSON.parse(fs.readFileSync(issuer.privateFile, 'utf8'));
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    server = ownedProcess(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, JARVIS_LICENSE_REQUIRED: 'true', JARVIS_LICENSE_PUBLIC_KEY_FILE: issuer.publicFile, APP_BUILD: run.id } }, run, 'vite.log');
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.qaError || server.exitCode !== null) throw Error('Test server failed; see vite.log');
      try { ready = (await fetch(origin, { signal: AbortSignal.timeout(500) })).ok; } catch { /* bounded readiness */ }
      if (ready) break; await pause(100);
    }
    if (!ready) throw Error('Vite startup timeout');
    context = await chromium.launchPersistentContext(path.join(run.dir, 'profile'), { executablePath: process.env.QA_CHROMIUM || which('chromium') || which('chromium-browser'), headless: true, chromiumSandbox: true, serviceWorkers: 'block' });
    const deniedOrigins = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      deniedOrigins.push(url.origin); return route.abort();
    });
    const page = context.pages()[0]; page.setDefaultTimeout(20000);
    await page.goto(origin); await page.getByRole('button', { name: /Panel właściciela — klucze APK/ }).click();
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
    await page.reload(); await page.locator('.boot').waitFor({ state: 'hidden' });
    if (await page.getByRole('button', { name: 'Aktywuj', exact: true }).count()) throw Error('Reload lost activation');
    run.write('verification.json', { run_id: run.id, level: 'B: real license UI and WebCrypto, not agent autonomy or native APK', license_required: true, test_issuer: true, wrong_issuer_rejected: true, independent_signature_valid: true, payload, token_sha256: createHash('sha256').update(token).digest('hex'), private_key_persisted: false, activation_persisted: true, reload_activated: true, denied_origins: [...new Set(deniedOrigins)] });
    run.record({ id: 'license-issue-activate', level: 'B', status: 'PASS', detail: 'Normal licensed gate → owner import proof → real local signature → independent verification → normal activation → reload. No license bypass.', evidence: ['verification.json', 'issued-license.png'] });
    run.finish();
  } catch (e) {
    run.write('error.txt', e.stack || e.message); run.record({ id: 'license-issue-activate', level: 'B', status: 'FAIL', detail: e.message, evidence: ['error.txt', 'vite.log'] }); run.finish(); process.exitCode = 1;
  } finally { await cleanup(); }
})();
