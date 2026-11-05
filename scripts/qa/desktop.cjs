/* global localStorage */
// Single entry point: independent UI checks, native Electron, then the real model.
const { pathToFileURL } = require('node:url');
const { fs, path, root, args, configuration, newRun, environment, inspectOllama, modelBlocker, dependencySnapshot, resultExitCode, pause, ownedProcess, stop } = require('./common.cjs');
async function main(argv = process.argv.slice(2)) {
  const run = newRun('desktop');
  const cleanups = []; let app, build, probe, interrupted = false;
  let cleanupPromise;
  let env, ollama, options, mode = 'isolated licensed test authority';
  function cleanup() { return cleanupPromise ||= (async () => {
    for (const fn of cleanups.reverse()) await fn().catch(() => {});
    if (app) { const owned = app.process(); await Promise.race([app.close().catch(() => {}), pause(3000)]); await stop(owned); app = null; }
    await stop(probe); await stop(build);
  })(); }
  function blocked(id, detail, blocker) { run.record({ id, level: id === 'C' ? 'target desktop' : 'Electron + real model', status: 'BLOCKED', detail, evidence: blocker.evidence, blocker }); }
  function complete(overrideCode) {
    for (const id of ['A', 'B', 'C']) if (!run.results.some(r => r.id === id)) run.record({ id, level: 'required scenario', status: 'NOT_RUN', detail: 'An earlier stage did not complete; no success inferred.' });
    const code = overrideCode ?? resultExitCode(run.results);
    const required = Object.fromEntries(['A', 'B', 'C'].map(id => [id, run.results.find(r => r.id === id).status]));
    run.finish({ runner_completed: !interrupted, required_scenarios: required, required_tests_passed: Object.values(required).every(s => s === 'PASS'), exit_code: code, mode, ollama_origin: ollama?.selected_origin || null, ollama_model: ollama?.model || null, production_settings_changed: false, license_required: true, xvfb_installed_or_started: false });
    process.exitCode = code;
  }
  const onSignal = signal => {
    interrupted = true; run.record({ id: 'interrupted', level: 'runner', status: 'NOT_RUN', detail: signal }); complete(130);
    void cleanup().finally(() => process.exit(130));
  };
  const signalHandlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => onSignal(signal)]));
  for (const [signal, handler] of Object.entries(signalHandlers)) process.once(signal, handler);
  try {
    options = args(argv); env = environment(); const deps = dependencySnapshot();
    run.write('environment.json', env); run.write('dependencies.json', deps);
    ollama = await inspectOllama(configuration(options), run);
    const config = { mode, service_candidates: ollama.candidates, service_source: ollama.url_source, selected_service: ollama.selected_origin, selected_model: ollama.model || null, model_source: ollama.model_source, license: options['license-file'] ? 'provided token, normal verification' : 'ephemeral issuer for isolated build; real signature and activation', license_disabled: false };
    run.write('test-config.json', config);
    const packages = deps.packages;
    if (deps.node_supported && packages.vite.available && packages.playwright.available) {
      const { chromium } = require('playwright');
      const browser = options.chromium || process.env.QA_CHROMIUM || env.tools.chromium || env.tools['chromium-browser'] || chromium.executablePath();
      if (fs.existsSync(browser)) {
        const { runLicenseUi } = require('./license-ui.cjs');
        const independent = await runLicenseUi({ run, localChecks: true, chromiumPath: browser, registerCleanup: fn => cleanups.push(fn) });
        if (independent.ok) run.independent = independent;
      } else run.record({ id: 'independent-browser', level: 'web Chromium', status: 'BLOCKED', detail: 'No installed Chromium executable.', evidence: ['dependencies.json'], blocker: { dependency: 'Chromium executable', command: 'resolve --chromium / QA_CHROMIUM / installed Chromium / Playwright cache', evidence: ['dependencies.json'], scenarios: ['independent local command/settings/restart'], action: 'Pass --chromium with an already installed compatible Chromium. QA does not download a browser.' } });
    } else run.record({ id: 'independent-browser', level: 'web Chromium', status: 'BLOCKED', detail: 'Missing Node >=20, Vite or Playwright.', evidence: ['dependencies.json'], blocker: { dependency: 'project dependencies', command: 'resolve installed package manifests', evidence: ['dependencies.json'], scenarios: ['independent local command/settings/restart'], action: 'Use Node >=20 and npm ci in this transferred copy.' } });

    const workspace = path.join(run.dir, 'workspace'), profile = path.join(run.dir, 'native-profile');
    fs.mkdirSync(workspace, { mode: 0o700 }); fs.mkdirSync(profile, { mode: 0o700 });
    const nativeSession = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    let nativeReady = false, nativeBlocker;
    if (options['license-file'] && !fs.existsSync(path.resolve(options['license-file']))) {
      nativeBlocker = { dependency: 'provided license file', command: 'check --license-file existence', evidence: ['test-config.json'], scenarios: ['A', 'B'], action: 'Pass an existing license file, or omit --license-file to use a normally activated ephemeral test issuer. No production license is changed.' };
    } else if (!deps.node_supported || !packages.vite.available || !packages.playwright.available || !deps.electron_binary) {
      nativeBlocker = { dependency: 'Node >=20, Vite, Playwright and installed Electron binary', command: 'dependencySnapshot()', evidence: ['dependencies.json'], scenarios: ['A', 'B', 'C'], action: 'Run npm ci with Node >=20. Install required Electron shared libraries separately under your local administrator policy; keep its sandbox enabled.' };
    } else if (!nativeSession) {
      const launch = { command: 'node_modules/electron/dist/electron .', cwd: root, profile, workspace, timeout_ms: 8000, sandbox_disabled: false, renderer_loaded: false, renderer_file_exists: fs.existsSync(path.join(root, 'dist/index.html')) };
      run.write('native-launch.json', launch);
      probe = ownedProcess(deps.electron_binary, ['.'], { env: { ...process.env, JARVIS_PROFILE_DIR: profile, JARVIS_WORKSPACE_DIR: workspace } }, run, 'electron-stderr.log');
      for (let i = 0; i < 80 && probe.exitCode === null && !probe.signalCode && !probe.qaError; i++) await pause(100);
      await stop(probe);
      const stderr = fs.readFileSync(path.join(run.dir, 'electron-stderr.log'), 'utf8');
      const sandbox = /SUID sandbox|No usable sandbox|setuid_sandbox_host/i.test(stderr);
      const noDisplay = /Missing X server|\$DISPLAY|platform failed to initialize/i.test(stderr);
      run.write('native-exit.json', { exit_code: probe.exitCode, signal: probe.signalCode, spawn_error: probe.qaError, diagnosis: sandbox ? 'sandbox helper configuration' : noDisplay ? 'missing graphical session' : 'see exact stderr; no display-only assumption' });
      nativeBlocker = { dependency: sandbox ? 'working Electron sandbox helper' : 'accessible graphical Electron session', command: launch.command, evidence: ['environment.json', 'native-launch.json', 'native-exit.json', 'electron-stderr.log'], scenarios: ['A', 'B', 'C'], action: sandbox ? 'Use a correctly installed Electron sandbox helper under administrator policy; do not disable sandbox.' : 'Run qa:desktop from the logged-in desktop session. Do not guess DISPLAY. Xvfb is neither installed nor started.' };
    } else {
      const { _electron } = require('playwright');
      let issuer = run.independent?.issuer, token = run.independent?.token;
      if (!options['license-file'] && !issuer) {
        const lic = await import(pathToFileURL(path.join(root, 'scripts/license.mjs')).href);
        issuer = await lic.initIssuer({ 'key-dir': path.join(run.dir, 'native-test-issuer'), 'public-file': path.join(run.dir, 'native-public.json') });
        token = await lic.signToken(JSON.parse(fs.readFileSync(issuer.privateFile, 'utf8')), 'QA native', 1);
      }
      if (options['license-file']) { mode = 'isolated profile, supplied license'; token = fs.readFileSync(path.resolve(options['license-file']), 'utf8').trim(); }
      const bundle = path.join(run.dir, 'licensed-dist');
      const testEnv = { ...process.env, JARVIS_LICENSE_REQUIRED: 'true', APP_BUILD: run.id, ...(!options['license-file'] ? { JARVIS_LICENSE_PUBLIC_KEY_FILE: issuer.publicFile, JARVIS_LICENSE_URL: '', JARVIS_LICENSE_STRICT: 'false' } : {}) };
      build = ownedProcess(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', bundle], { env: testEnv }, run, 'native-build.log');
      for (let i = 0; i < 1200 && build.exitCode === null && !build.qaError; i++) await pause(100);
      if (build.exitCode !== 0) throw Error('Isolated licensed build failed or timed out; see native-build.log');
      let first = true;
      async function openNative() {
        app = await _electron.launch({ executablePath: deps.electron_binary, args: [root], cwd: root, env: { ...testEnv, JARVIS_PROFILE_DIR: profile, JARVIS_WORKSPACE_DIR: workspace, JARVIS_QA_RENDERER_DIR: bundle }, chromiumSandbox: true, timeout: 30000 });
        await app.context().route('**/*', route => { const u = new URL(route.request().url()); return u.protocol === 'file:' || u.origin === ollama.selected_origin ? route.continue() : route.abort(); });
        const page = await app.firstWindow(); page.setDefaultTimeout(20000);
        if (first) {
          await page.getByPlaceholder('Klucz licencyjny…', { exact: true }).waitFor();
          await page.evaluate(({ url, model }) => {
            localStorage.setItem('jarvis.onboarded.v1', '1');
            localStorage.setItem('jarvis.settings.v2', JSON.stringify({ provider: 'ollama', model: model || 'auto', ollamaUrl: url || '', onDeviceOnly: true, webllmEnabled: false, speak: false, tips: false, proactiveOnOpen: false, prewarmLocal: false, councilMode: false, deepThink: false, memoryServiceUrl: '', requireConsentAlways: true }));
          }, { url: ollama.selected_origin, model: ollama.model });
          await page.reload(); await page.getByPlaceholder('Klucz licencyjny…', { exact: true }).fill(token);
          await page.getByRole('button', { name: 'Aktywuj', exact: true }).click(); first = false;
        }
        await page.getByPlaceholder('Wydaj polecenie JARVIS-owi…').waitFor(); return page;
      }
      try {
        let page = await openNative(); nativeReady = true;
        run.write('native-runtime.json', await app.evaluate(({ app, BrowserWindow }) => ({ version: app.getVersion(), profile: app.getPath('userData'), argv: process.argv, sandbox: BrowserWindow.getAllWindows().map(w => w.webContents.getLastWebPreferences().sandbox) })));
        const { verifyLocalChecks } = require('./license-ui.cjs');
        page = await verifyLocalChecks({ run, page, prefix: 'native', level: 'native Electron, real local tool', restart: async () => { await app.close(); app = null; return openNative(); } });
        if (ollama.stages.model === 'PASS' && ollama.stages.capabilities === 'PASS') await require('./agent-real.cjs').runScenarios({ run, page, workspace });
      } catch (e) {
        run.write('native-error.log', e.stack || e.message);
        if (nativeReady) run.record({ id: 'native-check', level: 'Electron', status: 'FAIL', detail: e.message, evidence: ['native-error.log'] });
        else nativeBlocker = { dependency: 'usable sandboxed Electron and valid activation in this session', command: '_electron.launch({chromiumSandbox:true}) and normal license activation', evidence: ['native-error.log'], scenarios: ['A', 'B', 'C'], action: 'Resolve the concrete startup or activation error recorded in native-error.log; keep licensing and sandbox enabled.' };
      }
    }
    if (nativeBlocker) run.record({ id: 'native-start', level: 'Electron', status: 'BLOCKED', detail: nativeBlocker.dependency, evidence: nativeBlocker.evidence, blocker: nativeBlocker });
    if (ollama.stages.model !== 'PASS' || ollama.stages.capabilities !== 'PASS') {
      const blocker = modelBlocker(ollama); blocker.scenarios = ['A', 'B'];
      if (ollama.stages.model === 'PASS') { blocker.dependency = 'installed model with verified tools capability'; blocker.action = 'Choose an already installed tools-capable model or resolve /api/show. No model is downloaded.'; }
      for (const id of ['A', 'B']) blocked(id, 'Real model prerequisite failed; independent checks continued.', blocker);
    } else if (nativeBlocker) for (const id of ['A', 'B']) blocked(id, nativeBlocker.dependency, nativeBlocker);
    if (!nativeSession) blocked('C', 'No authorized target desktop session available. Full selection/clipboard/editor automation and oracle also remain a known implementation gap.', { dependency: 'actual target desktop plus complete selection/clipboard/editor oracle', command: 'session inspection and isolated Electron startup probe', evidence: ['environment.json', ...(probe ? ['electron-stderr.log'] : ['dependencies.json'])], scenarios: ['C'], action: 'Use an authorized target desktop and complete the existing clipboard/focus test path. Running this runner locally alone does not implement C. No direct-file-write substitution.' });
    else run.record({ id: 'C', level: 'target desktop', status: 'NOT_RUN', detail: 'Full selection/clipboard/editor/save automation and oracle remain unimplemented. This capability gap is not a passing desktop test.', evidence: ['environment.json'] });
  } catch (e) { run.write('runner-error.txt', e.stack || e.message); run.record({ id: 'runner', level: 'runner', status: 'FAIL', detail: e.message, evidence: ['runner-error.txt'] }); }
  finally {
    let cleanupError = null;
    try { await cleanup(); } catch (e) { cleanupError = e.message; run.record({ id: 'cleanup', level: 'runner', status: 'FAIL', detail: e.message }); }
    run.write('cleanup.json', { only_owned_processes: true, completed: !cleanupError, error: cleanupError });
    complete(interrupted ? 130 : undefined); for (const [signal, handler] of Object.entries(signalHandlers)) process.removeListener(signal, handler);
  }
}
module.exports = { main };
if (require.main === module) void main();
