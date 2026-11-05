/* global localStorage */
const { chromium } = require('playwright');
const net = require('node:net');
const { args, configuration, newRun, environment, inspectOllama, modelBlocker, jsonRequest, which, path, root, pause, ownedProcess, stop } = require('./common.cjs');
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function stored(page) {
  // Independent read-only oracle: reads the persisted representation, never invokes a JARVIS tool or store mutator.
  return page.evaluate(() => ({ data: JSON.parse(localStorage.getItem('jarvis.data.v2') || '{}'), chats: JSON.parse(localStorage.getItem('jarvis.chats.v1') || '[]') }));
}
async function send(page, text) {
  const input = page.getByPlaceholder('Wydaj polecenie JARVIS-owi…');
  await input.click(); // require the normal composer to be unobstructed, including by setup dialogs
  await input.fill(text); await input.press('Enter');
}
async function dismissSetup(page) {
  const sheet = page.locator('.sheet').first();
  await sheet.waitFor({ state: 'visible' });
  await sheet.click({ position: { x: 5, y: 5 } }); // normal backdrop dismissal, without rewriting model settings
  await sheet.waitFor({ state: 'hidden' });
}
async function waitStored(page, title, timeout = 20000) {
  await page.waitForFunction(title => {
    const data = JSON.parse(localStorage.getItem('jarvis.data.v2') || '{}');
    return data.tasks?.filter(t => t.title === title).length === 1 && data.audit?.some(a => {
      let input;
      try { input = typeof a.input === 'string' ? JSON.parse(a.input) : a.input; } catch { return false; }
      return a.tool === 'add_task' && a.status === 'ok' && input?.title === title;
    });
  }, title, { timeout });
}
async function main() {
  const run = newRun('agent-smoke');
  let server, context;
  let closed = false;
  const cleanup = async () => { if (closed) return; closed = true; await context?.close().catch(() => {}); await stop(server); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
  try {
    const options = args();
    run.write('environment.json', environment());
    const ollama = await inspectOllama(configuration(options), run);
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    run.write('launch.json', { run_id: run.id, origin, profile: path.join(run.dir, 'chromium-profile'), license_required: false, scope: 'isolated dev server only', app_build: run.id, model_fixtures: false });
    server = ownedProcess(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, JARVIS_LICENSE_REQUIRED: 'false', APP_BUILD: run.id } }, run, 'vite.log');
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.qaError || server.exitCode !== null) throw Error(`Vite start failed: ${server.qaError || server.exitCode}; see vite.log`);
      try { ready = (await fetch(origin, { signal: AbortSignal.timeout(500) })).ok; } catch { /* bounded readiness retry */ }
      if (ready) break;
      await pause(100);
    }
    if (!ready) throw Error('Vite readiness timeout; see vite.log');
    const requests = [];
    async function openProfile() {
      const executablePath = options.chromium || process.env.QA_CHROMIUM || which('chromium') || which('chromium-browser');
      context = await chromium.launchPersistentContext(path.join(run.dir, 'chromium-profile'), { ...(executablePath ? { executablePath } : {}), headless: true, chromiumSandbox: true, args: ['--disable-dev-shm-usage'], viewport: { width: 1100, height: 820 }, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        // Requests pass to actual services unchanged; external destinations are denied, never fulfilled by fixtures.
        return url.origin === origin || url.origin === ollama.selected_origin ? route.continue() : route.abort();
      });
      const page = context.pages()[0] || await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('request', request => { if (request.url().includes('/api/chat')) requests.push({ run_id: run.id, at: new Date().toISOString(), event: 'request', url: request.url(), method: request.method() }); });
      page.on('response', response => { if (response.url().includes('/api/chat')) requests.push({ run_id: run.id, at: new Date().toISOString(), event: 'response', url: response.url(), status: response.status() }); });
      page.on('pageerror', error => { run.write('last-page-error.txt', error.stack || error.message); });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      return page;
    }
    let page = await openProfile();
    await page.evaluate(async ({ url, model }) => {
      localStorage.setItem('jarvis.onboarded.v1', '1');
      const { store } = await import('/src/lib/store.ts');
      store.setSettings({ provider: 'ollama', model: model || 'auto', ollamaUrl: url || '', webllmEnabled: false, onDeviceOnly: true, deepThink: false, councilMode: false, confidenceGate: false, speculativeMode: false, prewarmLocal: false, memoryServiceUrl: '', speak: false, tips: false });
    }, { url: ollama.selected_origin || (ollama.candidates.length === 1 ? ollama.candidates[0] : ''), model: ollama.model });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.boot').waitFor({ state: 'hidden' });
    const effectiveSettings = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('jarvis.settings.v2') || '{}');
      return { provider: s.provider, model: s.model, ollamaUrl: s.ollamaUrl, onDeviceOnly: s.onDeviceOnly, webllmEnabled: s.webllmEnabled };
    });
    run.write('effective-app-settings.json', { ...effectiveSettings, url_source: ollama.url_source, model_source: ollama.model_source });
    if (!effectiveSettings.ollamaUrl) {
      await dismissSetup(page);
      await page.getByText('BRAK KONFIGURACJI AI', { exact: false }).first().waitFor();
    }
    const title = `ORION ${run.id} — sprawdź żółć, ąę i zapis`;
    await send(page, `Dodaj zadanie: ${title}`);
    await waitStored(page, title);
    await page.locator('.bubble.assistant').filter({ hasText: title }).waitFor();
    const brand = await page.locator('.topbar .brand').boundingBox();
    if (!brand || brand.width < 160) throw Error('Header clips JARVIS brand/status');
    await page.getByRole('button', { name: 'STOP — zatrzymaj działania', exact: true }).waitFor({ state: 'visible' });
    const geometry = { viewport: page.viewportSize(), brand, composer: await page.getByPlaceholder('Wydaj polecenie JARVIS-owi…').boundingBox(), stop: await page.getByRole('button', { name: 'STOP — zatrzymaj działania', exact: true }).boundingBox() };
    run.write('D1-layout.json', geometry);
    if (!geometry.composer || geometry.composer.y < 0 || geometry.composer.y + geometry.composer.height > geometry.viewport.height) throw Error('Composer is outside the viewport after the task');
    await page.screenshot({ path: path.join(run.dir, 'D1-ui.png') });
    const before = await stored(page); run.write('D1-before-restart.json', before);
    await context.close(); context = null;
    page = await openProfile();
    await page.locator('.boot').waitFor({ state: 'hidden' });
    await waitStored(page, title);
    const after = await stored(page); run.write('D1-after-restart.json', after);
    if (after.data.tasks.filter(t => t.title === title).length !== 1 || !after.chats.some(c => c.messages.some(m => m.text.includes(title) && m.role === 'assistant'))) throw Error('D1 persisted task or assistant history missing after browser process restart');
    if (requests.length) throw Error('D1 unexpectedly invoked a model');
    run.record({ id: 'D1-local-task', level: 'B, deterministic tool', status: 'PASS', detail: 'Normal composer → askJarvis → requestConsent → real add_task → persisted Polish text and audit; browser process restarted, exactly one task and saved history. Not a model/desktop/resume test.', evidence: ['D1-ui.png', 'D1-before-restart.json', 'D1-after-restart.json'] });

    if (ollama.stages.model !== 'PASS') {
      run.record({ id: 'S1', level: 'D', status: 'BLOCKED', detail: 'No actual model generation could be attempted; exact discovery stage in ollama.json.', evidence: ['ollama.json'], blocker: modelBlocker(ollama) });
    } else {
      const direct = await jsonRequest(`${ollama.selected_origin}/api/chat`, { model: ollama.model, stream: false, think: false, messages: [{ role: 'user', content: `Oblicz 9 + 7. Odpowiedz krótko. Identyfikator testu ${run.id}.` }], options: { num_predict: 128 } }, 60000);
      run.write('real-generation.json', direct);
      ollama.stages.generation = direct.ok && direct.data?.message?.content?.includes('16') ? 'PASS' : 'FAIL';
      const question = `Ile wynosi 9 + 7? Odpowiedz jednym zdaniem. Test ${run.id}.`;
      await send(page, question);
      try {
        await page.waitForFunction(q => {
          const chats = JSON.parse(localStorage.getItem('jarvis.chats.v1') || '[]');
          return chats.some(c => { const i = c.messages.findIndex(m => m.role === 'user' && m.text === q); return i >= 0 && c.messages.slice(i + 1).some(m => m.role === 'assistant' && m.text.includes('16') && m.via?.toLowerCase().includes('ollama')); });
        }, question, { timeout: 180000 });
        if (!requests.some(r => r.event === 'response' && r.status === 200)) throw Error('No real model HTTP response observed');
        run.write('S1-history.json', await stored(page));
        ollama.stages.jarvis_chat = 'PASS';
        run.record({ id: 'S1', level: 'B + D', status: 'PASS', detail: 'Real local model replied to a normal UI message; arithmetic, provider provenance and saved history verified independently.', evidence: ['real-generation.json', 'S1-history.json', 'model-requests.json'] });
      } catch (e) { ollama.stages.jarvis_chat = 'FAIL'; run.record({ id: 'S1', level: 'B + D', status: 'FAIL', detail: e.message, evidence: ['real-generation.json', 'model-requests.json'] }); }
      if (ollama.stages.jarvis_chat === 'PASS' && ollama.stages.capabilities === 'PASS') {
        const modelTitle = `MODEL ${run.id} Żółć`;
        await send(page, `Zapisz w moich zadaniach nowe zadanie o dokładnym tytule „${modelTitle}”. Użyj narzędzia add_task. Nie opisuj tylko instrukcji.`);
        try {
          await waitStored(page, modelTitle, 180000);
          run.write('D2-real-model-tool.json', await stored(page));
          ollama.stages.jarvis_tool = 'PASS';
          run.record({ id: 'D2-model-tool', level: 'B + D', status: 'PASS', detail: 'Real model selected and called add_task; title and successful audit independently observed.', evidence: ['D2-real-model-tool.json', 'model-requests.json'] });
        } catch (e) { ollama.stages.jarvis_tool = 'FAIL'; run.record({ id: 'D2-model-tool', level: 'B + D', status: 'FAIL', detail: e.message, evidence: ['model-requests.json'] }); }
      }
    }
    for (const id of ['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']) {
      run.record({ id, level: id === 'S4' || id === 'S5' ? 'C/D or E' : 'D', status: 'NOT_RUN', detail: 'Full scenario not executed by this smoke runner. See continuation report for known capability defects and dependencies; D1 is not substituted for this scenario.', evidence: ['ollama.json'] });
    }
    run.write('model-requests.json', requests); run.write('ollama.json', ollama);
    run.finish({ license: 'disabled only for isolated development UI; normal startup not tested here' });
    process.exitCode = run.results.some(x => x.status === 'FAIL') ? 1 : run.results.some(x => x.status === 'BLOCKED' || x.status === 'NOT_RUN') ? 2 : 0;
  } catch (e) {
    const page = context?.pages()[0];
    if (page) {
      await page.screenshot({ path: path.join(run.dir, 'failure-ui.png') }).catch(() => {});
      await stored(page).then(data => run.write('failure-storage.json', data)).catch(() => {});
      await page.locator('body').innerText().then(text => run.write('failure-ui.txt', text)).catch(() => {});
    }
    run.write('runner-error.txt', e.stack || e.message);
    run.record({ id: 'runner', level: 'B', status: 'FAIL', detail: e.message, evidence: ['runner-error.txt', 'vite.log'] }); run.finish(); process.exitCode = 1;
  } finally { await cleanup(); }
}
module.exports = { freePort, stored, send, dismissSetup };
if (require.main === module) void main();
