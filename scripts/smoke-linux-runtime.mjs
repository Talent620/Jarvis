#!/usr/bin/env node
// Real packaged Electron/AppImage; Ollama HTTP responses are explicitly simulated.
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.includes('--help')) {
  console.log(`Usage: npm run test:linux-runtime -- [path/to/JARVIS.AppImage]
Requires Linux, a graphical session (or xvfb-run), and Playwright's Electron driver.
JARVIS_PLAYWRIGHT_MODULE: optional local Playwright module/package path.
JARVIS_SMOKE_NO_SANDBOX=1: explicit opt-in for restricted test containers only.
JARVIS_SMOKE_SCREENSHOT: optional screenshot output path.
Uses a fresh temporary profile and SIMULATED Ollama; no real model quality claims.
See docs/LINUX_RUNTIME_SMOKE.md for personal-build and driver setup.`);
  process.exit(0);
}
assert.equal(process.platform, 'linux', 'This AppImage smoke requires Linux.');
assert(process.getuid() !== 0 || process.env.JARVIS_SMOKE_NO_SANDBOX === '1', 'Run as a non-root user: Playwright otherwise disables the Electron sandbox implicitly.');
assert(process.env.DISPLAY || process.env.WAYLAND_DISPLAY, 'No display. Use xvfb-run -a npm run test:linux-runtime.');
assert(process.argv.length <= 3, 'Expected at most one AppImage path; see --help.');
const executable = path.resolve(process.argv[2] || path.join(root, 'release-desktop/JARVIS.AppImage'));
assert((await stat(executable)).isFile(), 'AppImage must be an existing file.');
await access(executable, constants.X_OK);
const require = createRequire(import.meta.url);
let driver;
try {
  const requested = process.env.JARVIS_PLAYWRIGHT_MODULE || 'playwright';
  const location = requested.startsWith('file:') ? new URL(requested)
    : pathToFileURL(require.resolve(requested, { paths: [process.cwd(), root] }));
  const module = await import(location.href);
  driver = module._electron || module.default?._electron;
  assert(driver, 'Playwright module has no Electron driver.');
} catch (error) {
  throw new Error('Cannot load Playwright. Set JARVIS_PLAYWRIGHT_MODULE to a local installation; see docs/LINUX_RUNTIME_SMOKE.md.', { cause: error });
}

const dir = await mkdtemp(path.join(os.tmpdir(), 'jarvis-runtime-smoke-'));
const runtimeDir = path.join(dir, 'runtime');
const model = 'qwen2.5:1.5b';
const task = 'Zadanie po zamknięciu AppImage';
const simulatedResult = 'SYMULOWANY WYNIK PO ZAMKNIĘCIU';
let app, page, connection, calls = 0, releaseJob, succeeded = false;
const pendingJob = new Promise((resolve) => { releaseJob = resolve; });
const cleanupFailures = [];

async function until(check, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}

const fixture = http.createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: model, size: 986000000, details: { format: 'gguf', family: 'qwen2' } }] }));
    if (request.url === '/api/show') return response.end(JSON.stringify({ details: { format: 'gguf', family: 'qwen2' }, model_info: { 'general.architecture': 'qwen2' }, capabilities: ['completion'] }));
    if (request.url === '/api/chat') {
      calls += 1;
      const prompt = body.messages?.at(-1)?.content || '';
      const background = prompt.includes(task);
      // Hold this response until the GUI process has actually exited.
      if (background) await pendingJob;
      return response.end(JSON.stringify({ done: true, message: { role: 'assistant', content: background ? simulatedResult : 'OK' } }));
    }
    response.writeHead(404).end('{}');
  } catch {
    if (!response.headersSent) response.writeHead(400);
    response.end('{}');
  }
});

async function readConnection() {
  const value = JSON.parse(await readFile(path.join(runtimeDir, 'connection.json'), 'utf8'));
  const url = new URL(value.url);
  assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password, 'Unexpected runtime endpoint.');
  assert(/^[a-f0-9]{64}$/.test(value.token), 'Invalid runtime token.');
  assert(Number.isSafeInteger(value.pid) && value.pid > 1, 'Invalid runtime PID.');
  return value;
}
async function api(endpoint, method = 'GET') {
  const response = await fetch(`${connection.url}${endpoint}`, {
    method, headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(5000), redirect: 'error',
  });
  assert(response.ok, `${endpoint}: HTTP ${response.status}`);
  return response.json();
}
const exited = (child) => child.exitCode !== null || child.signalCode !== null;
async function closeApp(force = false) {
  if (!app) return;
  const current = app;
  // Playwright clears its process handle on close: capture the child BEFORE closing.
  const child = current.process();
  void current.close().catch(() => {});
  try {
    await until(() => exited(child), 5000, 'AppImage main process did not exit normally.');
  } catch (error) {
    if (!force) throw error;
    child.kill('SIGTERM');
    try { await until(() => exited(child), 2000, 'AppImage SIGTERM timed out.'); }
    catch { child.kill('SIGKILL'); await until(() => exited(child), 2000, 'AppImage cleanup failed.'); }
  }
  app = undefined;
}
async function ownedRuntimePids() {
  const ids = await readdir('/proc');
  const owned = await Promise.all(ids.filter((id) => /^\d+$/.test(id)).map(async (id) => {
    try {
      const args = (await readFile(`/proc/${id}/cmdline`, 'utf8')).split('\0');
      if (!args.includes('start') || !args.some((arg) => arg.endsWith('/cli.mjs'))) return null;
      const env = (await readFile(`/proc/${id}/environ`, 'utf8')).split('\0');
      return env.includes(`JARVIS_RUNTIME_DATA_DIR=${runtimeDir}`) ? Number(id) : null;
    } catch { return null; }
  }));
  return owned.filter((id) => id !== null);
}
async function stopRuntime() {
  if (!connection) { try { connection = await readConnection(); } catch { /* startup may have failed before discovery */ } }
  if (connection) await api('/v1/stop', 'POST').catch(() => {});
  try { await until(async () => (await ownedRuntimePids()).length === 0, 3000, 'Runtime graceful shutdown timed out.'); }
  catch {
    // Kill only a cli.mjs process carrying this unique test data directory, never an unrelated service.
    for (const pid of await ownedRuntimePids()) { try { process.kill(pid, 'SIGTERM'); } catch { /* exited */ } }
    try { await until(async () => (await ownedRuntimePids()).length === 0, 2000, 'Runtime SIGTERM timed out.'); }
    catch {
      for (const pid of await ownedRuntimePids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* exited */ } }
      await until(async () => (await ownedRuntimePids()).length === 0, 2000, 'Runtime cleanup failed.');
    }
  }
}

async function captureScreenshot() {
  if (!process.env.JARVIS_SMOKE_SCREENSHOT || !page || page.isClosed()) return;
  const screenshot = path.resolve(process.env.JARVIS_SMOKE_SCREENSHOT);
  await mkdir(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, timeout: 5000 });
}

try {
  await mkdir(path.join(dir, 'session'), { mode: 0o700 });
  await chmod(dir, 0o700);
  await new Promise((resolve, reject) => {
    fixture.once('error', reject);
    fixture.listen(0, '127.0.0.1', resolve);
  });
  const env = {
    ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', JARVIS_RUNTIME_PORT: '0', JARVIS_RUNTIME_DATA_DIR: runtimeDir,
    JARVIS_RUNTIME_OLLAMA_URL: `http://127.0.0.1:${fixture.address().port}`, JARVIS_RUNTIME_BOOTSTRAP: '',
    JARVIS_WORKSPACE_DIR: path.join(dir, 'workspace'), XDG_STATE_HOME: path.join(dir, 'state'),
    XDG_CONFIG_HOME: path.join(dir, 'config'), XDG_DATA_HOME: path.join(dir, 'data'), XDG_CACHE_HOME: path.join(dir, 'cache'),
    XDG_RUNTIME_DIR: path.join(dir, 'session'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${dir}/session/no-bus`,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.JARVIS_RUNTIME_MODEL;
  const args = ['--disable-gpu', `--user-data-dir=${path.join(dir, 'profile')}`];
  if (process.env.JARVIS_SMOKE_NO_SANDBOX === '1') {
    args.unshift('--no-sandbox');
    console.warn('Explicit container opt-in: this smoke runs Electron without its process sandbox.');
  }
  const launch = () => driver.launch({ executablePath: executable, args, env, timeout: 45000 });
  app = await launch();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  console.log('Real AppImage launched; model backend is a SIMULATED Ollama HTTP fixture.');
  try {
    await page.waitForFunction((name) => JSON.parse(globalThis.localStorage.getItem('jarvis.settings.v2') || '{}').ollamaModelSimple === name, model, { timeout: 35000 });
  } catch (error) {
    if (await page.getByRole('button', { name: 'Aktywuj', exact: true }).count()) {
      throw new Error('This smoke requires a personal build: JARVIS_LICENSE_REQUIRED=false npm run build, then package AppImage. No license state is injected.', { cause: error });
    }
    throw error;
  }
  await page.waitForFunction(() => !globalThis.document.querySelector('.boot'), null, { timeout: 20000 });
  assert.equal(await page.locator('.onboarding').count(), 0, 'Automatic local setup completes onboarding.');
  connection = await readConnection();
  const firstPid = connection.pid;
  assert.equal((await stat(path.join(runtimeDir, 'connection.json'))).mode & 0o777, 0o600, 'Private discovery permissions.');
  assert.equal((await api('/v1/status')).readiness.state, 'READY');
  await page.getByRole('button', { name: 'Analizy w tle', exact: true }).click();
  await page.locator('#runtime-prompt').fill(task);
  await page.getByRole('button', { name: 'Dodaj do kolejki serwera', exact: true }).click();
  await page.waitForFunction(() => globalThis.document.querySelector('#runtime-prompt')?.value === '');
  await until(async () => (await api('/v1/status')).queue.running === 1, 10000, 'Background job never started.');
  await closeApp();
  releaseJob();
  await until(async () => (await api('/v1/status')).queue.completed === 1, 15000, 'Worker did not finish after AppImage exited.');
  assert.equal((await api('/v1/jobs')).jobs[0].result, simulatedResult);
  console.log('AppImage exited; detached worker completed and persisted the simulated result.');

  app = await launch();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !globalThis.document.querySelector('.boot'), null, { timeout: 20000 });
  const discovered = await page.evaluate(() => globalThis.jarvisDesktop.runtimeConnection());
  const secondConnection = await readConnection();
  assert.equal(secondConnection.pid, firstPid, 'Reopening must reuse the worker.');
  // Boolean assertion avoids printing authentication tokens when this check fails in CI.
  assert(discovered?.token === connection.token, 'Reopening must preserve authentication.');
  await page.getByRole('button', { name: 'Analizy w tle', exact: true }).click();
  await page.getByRole('button', { name: 'Wyniki i historia', exact: true }).click();
  await page.getByText(simulatedResult, { exact: true }).waitFor();
  await captureScreenshot();
  succeeded = true;
} catch (error) {
  try { await captureScreenshot(); } catch { /* diagnostics must not hide the original failure */ }
  throw error;
} finally {
  releaseJob();
  try { await closeApp(true); } catch (error) { cleanupFailures.push(error.message); }
  try { await stopRuntime(); } catch (error) { cleanupFailures.push(error.message); }
  fixture.closeAllConnections();
  if (fixture.listening) await new Promise((resolve) => fixture.close(resolve));
  try { await rm(dir, { recursive: true, force: true }); } catch (error) { cleanupFailures.push(error.message); }
  if (cleanupFailures.length) {
    console.error('Smoke cleanup errors:', cleanupFailures.join('; '));
    process.exitCode = 1;
  }
}
if (succeeded && !cleanupFailures.length) {
  console.log(JSON.stringify({ actualAppImage: true, automaticServer: true, automaticChatConfiguration: true,
    automaticProbe: true, survivesAppImageClose: true, reusesPidAndToken: true, persistedResult: true,
    cleanup: true, noSandboxOptIn: process.env.JARVIS_SMOKE_NO_SANDBOX === '1', model: 'SIMULATED_OLLAMA_HTTP_FIXTURE', modelCalls: calls }));
}
