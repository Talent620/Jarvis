/* global require, URL, console, process, setTimeout, localStorage */
/* eslint-disable @typescript-eslint/no-require-imports */
// UI + controlled Ollama protocol fixture. This is NOT a test with a real language model.
const { chromium } = require('playwright');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, chromiumSandbox: true, args: ['--disable-dev-shm-usage'] });
  const source = { base_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tracked_code_diff_sha256: createHash('sha256').update(execFileSync('git', ['diff', '--', 'src', 'electron', 'eslint.config.js'])).digest('hex'), test_build: '2026-11-05 18:56', browser: browser.version() };
  source.new_source_files = Object.fromEntries(execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).trim().split("\n").filter(name => name.startsWith("src/") || name.startsWith("electron/")).map(name => [name, createHash("sha256").update(fs.readFileSync(name)).digest("hex")]));
  const results = [];
  try {
    for (let trial = 0; trial < 3; trial++) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
      let release;
      let ready;
      const waiting = new Promise(resolve => { ready = resolve; });
      const delayed = new Promise(resolve => { release = resolve; });
      let aborted = false;
      const page = await context.newPage();
      page.on('requestfailed', request => { if (request.url().includes(':11435/api/chat')) aborted = true; });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.host === '127.0.0.1:5192') return route.continue();
        if (url.host === '127.0.0.1:11435') {
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
          if (url.pathname === '/api/chat') {
            ready(); await delayed;
            try { await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'add_note', arguments: { text: 'STOP_ORION_FORBIDDEN' } } }] } }) }); } catch { /* Aborted transport is the expected result. */ }
            return;
          }
          return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ models: [] }) });
        }
        return route.abort();
      });
      await page.goto('http://127.0.0.1:5192/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(async () => {
        localStorage.setItem('jarvis.onboarded.v1', '1');
        const { store } = await import('/src/lib/store.ts');
        store.setSettings({ provider: 'ollama', model: 'protocol-fixture', ollamaUrl: 'http://127.0.0.1:11435', onDeviceOnly: true, deepThink: false, councilMode: false, confidenceGate: false, speculativeMode: false, memoryServiceUrl: '', speak: false, tips: false });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.boot').waitFor({ state: 'hidden', timeout: 10000 });
      const input = page.getByPlaceholder('Wydaj polecenie JARVIS-owi…');
      await input.fill('Dodaj notatkę ORION do moich notatek'); await input.press('Enter');
      await Promise.race([waiting, new Promise((_, reject) => setTimeout(() => reject(Error('Nie wywołano API modelu')), 10000))]);
      const started = performance.now();
      if (trial === 1) { await input.fill('stop'); await input.press('Enter'); }
      else await page.getByRole('button', { name: 'STOP — zatrzymaj działania', exact: true }).click();
      await page.getByRole('button', { name: 'Zatrzymaj generowanie', exact: true }).waitFor({ state: 'hidden', timeout: 1000 });
      const acknowledgedMs = Math.round(performance.now() - started);
      release();
      await page.waitForTimeout(250);
      const notes = await page.evaluate(async () => (await import('/src/lib/store.ts')).store.data.notes.map(n => n.text));
      if (notes.includes('STOP_ORION_FORBIDDEN')) throw Error('FAIL: efekt uboczny po STOP');
      await input.fill('Włącz nowy interfejs'); await input.press('Enter');
      await page.locator('.app.interface-modern').waitFor();
      results.push({ trial: trial + 1, variant: trial === 1 ? 'typed-stop' : 'global-button', outcome: 'PASS', acknowledged_ms: acknowledgedMs, model: 'controlled protocol fixture, not LLM', late_side_effects: 0, transport_aborted: aborted, continued_local_command: true });
      await context.close();
    }
    fs.writeFileSync('QA/autonomia60/evidence/stop-ui.json', JSON.stringify({ layer: 'UI + protocol fixture', source, results }, null, 2) + '\n');
    console.log(JSON.stringify(results));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
