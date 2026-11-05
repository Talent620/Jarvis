/* global localStorage */
const { _electron } = require('playwright');
const { spawn } = require('node:child_process');
const { fs, path, root, args, newRun, environment, which, pause, ownedProcess, stop } = require('./common.cjs');
const { send, stored, dismissSetup } = require('./agent-smoke.cjs');
async function main() {
  const run = newRun('desktop');
  let display, electron, build, app;
  let cleaned = false;
  async function cleanup() { if (cleaned) return; cleaned = true; await app?.close().catch(() => {}); await stop(electron); await stop(build); await stop(display); }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
  try {
    args(); // reject mistyped flags rather than silently use defaults
    const env = environment(); run.write('environment.json', env);
    const session = { ...process.env };
    if (!session.DISPLAY && !session.WAYLAND_DISPLAY && which('Xvfb')) {
      const log = fs.openSync(path.join(run.dir, 'xvfb.log'), 'a', 0o600);
      display = spawn(which('Xvfb'), ['-nolisten', 'tcp', '-screen', '0', '1280x900x24', '-displayfd', '3'], { stdio: ['ignore', log, log, 'pipe'] });
      fs.closeSync(log);
      const number = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Xvfb displayfd timeout')), 10000);
        display.once('error', e => { clearTimeout(timer); reject(e); });
        display.stdio[3].once('data', data => { clearTimeout(timer); resolve(data.toString().trim()); });
        display.once('exit', code => { clearTimeout(timer); reject(Error(`Xvfb exited ${code}`)); });
      });
      if (!/^\d+$/.test(number)) throw Error('Invalid Xvfb displayfd response');
      session.DISPLAY = `:${number}`;
      run.write('display.json', { source: 'owned Xvfb displayfd; not a guessed user display', virtual: true });
    }
    if (!session.DISPLAY && !session.WAYLAND_DISPLAY) {
      const launchEnv = { ...session, JARVIS_PROFILE_DIR: path.join(run.dir, 'normal-profile'), JARVIS_WORKSPACE_DIR: path.join(run.dir, 'workspace') };
      fs.mkdirSync(launchEnv.JARVIS_PROFILE_DIR, { mode: 0o700 }); fs.mkdirSync(launchEnv.JARVIS_WORKSPACE_DIR, { mode: 0o700 });
      run.write('launch.json', { command: 'node_modules/electron/dist/electron .', cwd: root, profile: launchEnv.JARVIS_PROFILE_DIR, workspace: launchEnv.JARVIS_WORKSPACE_DIR, timeout_ms: 8000, sandbox_disabled: false, renderer_loaded: false });
      electron = ownedProcess(require('electron'), ['.'], { env: launchEnv }, run, 'electron-stderr.log');
      for (let i = 0; i < 80 && electron.exitCode === null && !electron.signalCode && !electron.qaError; i++) await pause(100);
      await stop(electron);
      const stderr = fs.readFileSync(path.join(run.dir, 'electron-stderr.log'), 'utf8');
      const missingDisplay = /Missing X server|\$DISPLAY|ozone.*platform.*failed|failed to initialize/i.test(stderr);
      const sandbox = /SUID sandbox|No usable sandbox|setuid_sandbox_host/i.test(stderr);
      const detail = sandbox ? 'Electron failed before renderer startup: sandbox helper configuration.' : missingDisplay ? 'Electron failed before renderer startup: no graphical session; Xvfb is not installed.' : 'Electron did not reach an observable renderer; inspect exact stderr, not assumed to be a DISPLAY error.';
      run.write('electron-exit.json', { exit_code: electron.exitCode, signal: electron.signalCode, spawn_error: electron.qaError, diagnosis: detail });
      run.record({ id: 'Electron-start', level: 'C', status: 'BLOCKED', detail, evidence: ['environment.json', 'launch.json', 'electron-stderr.log', 'electron-exit.json'], blocker: { dependency: sandbox ? 'working Electron sandbox helper' : 'accessible graphical session or existing Xvfb', command: 'node_modules/electron/dist/electron . (isolated profile, sandbox retained)', evidence: ['electron-stderr.log'], scenarios: ['S2', 'S3', 'S4', 'S5', 'S8'], action: sandbox ? 'Use a correctly installed Electron package/sandbox helper under the system administrator’s policy; retain sandbox.' : 'Run npm run qa:desktop in a logged-in desktop session, or authorize installing Xvfb in this test machine. Do not guess DISPLAY.' } });
      run.record({ id: 'normal-license-startup', level: 'C', status: 'NOT_RUN', detail: 'Renderer never loaded; normal license activation path was not tested.' });
      run.finish(); process.exitCode = 2; return;
    }
    for (const licensed of [true, false]) {
      const kind = licensed ? 'normal' : 'isolated-dev';
      const bundle = path.join(run.dir, `${kind}-dist`);
      build = ownedProcess(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', bundle], { env: { ...process.env, JARVIS_LICENSE_REQUIRED: licensed ? 'true' : 'false', APP_BUILD: run.id } }, run, `${kind}-build.log`);
      for (let i = 0; i < 1200 && build.exitCode === null && !build.qaError; i++) await pause(100);
      if (build.exitCode !== 0) throw Error(`${kind} build failed or timed out; see build log`);
      const profile = path.join(run.dir, `${kind}-profile`), workspace = path.join(run.dir, 'workspace');
      fs.mkdirSync(profile, { mode: 0o700 }); fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
      const launchEnv = { ...session, JARVIS_PROFILE_DIR: profile, JARVIS_WORKSPACE_DIR: workspace, JARVIS_QA_RENDERER_DIR: bundle };
      // Playwright otherwise adds --no-sandbox on Linux. Explicitly retain Chromium's sandbox.
      try { app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env: launchEnv, chromiumSandbox: true, timeout: 30000 }); }
      catch (e) {
        run.write(`${kind}-electron-error.log`, e.message);
        run.record({ id: `${kind}-Electron-start`, level: 'C', status: 'BLOCKED', detail: 'Actual Electron launch failed; see complete launch command and stderr.', evidence: [`${kind}-electron-error.log`], blocker: { dependency: 'usable Electron runtime in this graphical session', command: 'playwright._electron.launch({chromiumSandbox:true})', evidence: [`${kind}-electron-error.log`], scenarios: ['S2', 'S3', 'S4', 'S5', 'S8'], action: 'Resolve the concrete Electron startup error recorded in the log, keeping the sandbox enabled, then rerun qa:desktop.' } });
        process.exitCode = 2; run.finish(); return;
      }
      run.write(`${kind}-runtime.json`, await app.evaluate(({ app, BrowserWindow }) => ({ version: app.getVersion(), userData: app.getPath('userData'), argv: process.argv, windows: BrowserWindow.getAllWindows().map(w => ({ title: w.getTitle(), webPreferences: w.webContents.getLastWebPreferences() })) })));
      const page = await app.firstWindow(); page.setDefaultTimeout(20000);
      await app.context().route('**/*', route => route.request().url().startsWith('file:') ? route.continue() : route.abort());
      if (licensed) {
        await page.getByRole('button', { name: 'Aktywuj', exact: true }).waitFor();
        await page.screenshot({ path: path.join(run.dir, 'normal-license.png') });
        run.record({ id: 'normal-license-startup', level: 'C', status: 'PASS', detail: 'Fresh isolated production-style build reached the normal license gate. No private license used.', evidence: ['normal-runtime.json', 'normal-license.png'] });
      } else {
        await page.evaluate(() => {
          localStorage.setItem('jarvis.onboarded.v1', '1');
          const settings = JSON.parse(localStorage.getItem('jarvis.settings.v2') || '{}');
          localStorage.setItem('jarvis.settings.v2', JSON.stringify({ ...settings, provider: 'ollama', ollamaUrl: '', onDeviceOnly: true, webllmEnabled: false, speak: false, tips: false }));
        });
        await page.reload(); await page.locator('.boot').waitFor({ state: 'hidden' }); await dismissSetup(page);
        const title = `Electron ${run.id} Żółć`;
        await send(page, `Dodaj zadanie: ${title}`);
        await page.waitForFunction(title => JSON.parse(localStorage.getItem('jarvis.data.v2') || '{}').tasks?.some(t => t.title === title), title);
        run.write('electron-task.json', await stored(page));
        await page.screenshot({ path: path.join(run.dir, 'electron-task.png') });
        run.record({ id: 'D1-electron-task', level: 'C deterministic tool', status: 'PASS', detail: 'Actual sandboxed Electron, isolated development build, normal composer and real local tool. Not real-model or user-desktop proof.', evidence: ['isolated-dev-runtime.json', 'electron-task.json', 'electron-task.png'] });
      }
      await app.close(); app = null;
    }
    run.finish({ session: display ? 'owned virtual X11; not Wayland' : 'current graphical session; no clipboard test performed', S1_S8: 'not inferred from startup smoke' });
  } catch (e) { run.write('runner-error.txt', e.stack || e.message); run.record({ id: 'runner', level: 'C', status: 'FAIL', detail: e.message, evidence: ['runner-error.txt'] }); run.finish(); process.exitCode = 1; }
  finally { await cleanup(); }
}
void main();
