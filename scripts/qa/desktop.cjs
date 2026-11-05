/* global localStorage, document, window */
// Single entry point: independent UI checks, native Electron, then the real model.
const { pathToFileURL } = require('node:url');
const { fs, path, root, args, configuration, newRun, environment, inspectOllama, modelBlocker, dependencySnapshot, resultExitCode, pause, ownedProcess, stop } = require('./common.cjs');
const { execFileSync } = require('node:child_process');

// Read-only oracle. Native input must come from JARVIS, never Playwright/Xdotool in QA.
function clipboardOracle({ expected, copies, pasteObservations, file, audit, modelResponse, assistantReply }) {
  const copied = copies.some(e => e.trusted && e.focused && e.text === expected);
  const pasted = pasteObservations.some(e => e.editor_focused && e.clipboard === expected && e.source_copy_observed);
  const inputs = audit.map(a => { try { return { ...a, input: typeof a.input === 'string' ? JSON.parse(a.input) : a.input }; } catch { return { ...a, input: {} }; } });
  const pasteTool = inputs.some(a => a.tool === 'desktop_hotkey' && a.status === 'ok' && a.input?.combo?.toLowerCase() === 'ctrl+v');
  const saveTool = inputs.some(a => a.tool === 'desktop_hotkey' && a.status === 'ok' && ['ctrl+s', 'ctrl+shift+s'].includes(a.input?.combo?.toLowerCase()));
  const readTool = inputs.some(a => a.tool === 'system_files_read' && a.status === 'ok' && a.output?.includes(expected));
  const forbiddenWrite = inputs.some(a => ['system_files_write', 'system_run', 'system_terminal'].includes(a.tool));
  // A native editor may append its conventional final LF; record the exact bytes separately.
  return { copied, pasted, pasteTool, saveTool, readTool, forbiddenWrite, fileMatches: file === expected || file === expected + '\n', modelResponse: !!modelResponse, assistantReply: !!assistantReply,
    passed: copied && pasted && pasteTool && saveTool && readTool && !forbiddenWrite && (file === expected || file === expected + '\n') && !!modelResponse && !!assistantReply };
}

async function runDesktopScenario({ run, app, page, workspace, env }) {
  const prerequisite = env.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'x11' && process.env.DISPLAY && env.tools.xdotool && env.tools.mousepad;
  if (!prerequisite) {
    run.record({ id: 'C', level: 'native X11 + actual Mousepad + real model', status: 'BLOCKED', detail: 'Implemented clipboard/focus oracle requires an authorized X11 session, existing xdotool and Mousepad; no installations are performed.', evidence: ['environment.json'], blocker: { dependency: 'X11, xdotool and Mousepad', action: 'Run in an authorized Linux X11 session with these existing dependencies. Wayland input adapter remains MISSING_IMPLEMENTATION; this test does not bypass its security.' } });
    return;
  }
  const { send, stored } = require('./agent-smoke.cjs');
  const nativeRead = args => { try { return execFileSync(env.tools.xdotool, args, { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
  const sourceTitle = `JARVIS QA Source ${run.id.slice(-8)}`, expected = `Drugi akapit ${run.id}: Zażółć gęślą jaźń.`, target = path.join(workspace, 'notatka.txt');
  let editor, source, sourceId; const consents = [], pasteObservations = [], responses = [];
  let command; const taggedRequests = new WeakSet();
  const requestListener = request => { try { const users = request.postDataJSON()?.messages?.filter(m => m.role === 'user'); if (request.url().includes('/api/chat') && users?.at(-1)?.content === command) taggedRequests.add(request); } catch { /* unrelated request */ } };
  const responseListener = response => { if (taggedRequests.has(response.request())) responses.push({ status: response.status(), at: Date.now() }); };
  page.on('request', requestListener); page.on('response', responseListener);
  try {
    if (fs.existsSync(target)) throw Error('C target already exists; refusing to overwrite it');
    const jarvisNativeId = await (await app.browserWindow(page)).evaluate(w => String(w.getNativeWindowHandle().readUInt32LE(0)));
    const fixture = path.join(workspace, 'strona-testowa.html');
    fs.writeFileSync(fixture, `<!doctype html><html lang="pl"><meta charset="utf-8"><title>${sourceTitle}</title><style>body{font:24px sans-serif;padding:32px}main{border:1px solid;padding:20px}</style><main contenteditable="true" role="document" aria-label="Trzy akapity" tabindex="0"><p>Pierwszy akapit: tekst przed zadaniem.</p><p>${expected}</p><p>Trzeci akapit: tekst po zadaniu.</p></main></html>`, { mode: 0o600 });
    // Prepare fixtures only: source is not selected/copied and the real editor starts empty.
    const sourceWindow = app.waitForEvent('window');
    sourceId = await app.evaluate(async ({ BrowserWindow }, file) => {
      const w = new BrowserWindow({ width: 860, height: 500, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await w.loadFile(file); return w.id;
    }, fixture);
    source = await sourceWindow;
    await source.evaluate(() => {
      window.__qaCopies = [];
      document.addEventListener('copy', event => window.__qaCopies.push({ text: window.getSelection()?.toString(), trusted: event.isTrusted, focused: document.hasFocus(), at: Date.now() }));
    });
    const editorEnv = { ...process.env, GSETTINGS_BACKEND: 'memory' };
    for (const key of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) { editorEnv[key] = path.join(run.dir, `editor-${key.toLowerCase()}`); fs.mkdirSync(editorEnv[key], { recursive: true, mode: 0o700 }); }
    editor = ownedProcess(env.tools.mousepad, ['--disable-server', '--opening-mode=window'], { env: editorEnv }, run, 'C-editor.log');
    let editorWindows = [];
    function observeEditor() { return nativeRead(['search', '--onlyvisible', '--pid', String(editor.pid)]).split(/\s+/).filter(id => /^\d+$/.test(id)).map(id => ({ id, title: nativeRead(['getwindowname', id]) })).filter(w => w.title); }
    for (let i = 0; i < 100; i++) { editorWindows = observeEditor(); if (editorWindows.length) break; if (editor.qaError || editor.exitCode !== null) break; await pause(100); }
    if (!editorWindows.length) throw Error('Actual isolated Mousepad did not expose a visible window; see C-editor.log');
    const sourceNativeId = await app.evaluate(({ BrowserWindow }, id) => String(BrowserWindow.fromId(id).getNativeWindowHandle().readUInt32LE(0)), sourceId);
    const before = await stored(page), beforeIds = new Set((before.data.audit || []).map(a => a.id));
    command = `Zaznacz drugi akapit strony testowej w oknie „${sourceTitle}”, skopiuj go do przygotowanego pustego edytora Mousepad (${editorWindows[0].title}) i zapisz jako ${target}. Użyj rzeczywistego zaznaczenia, schowka i wklejenia. Nie przepisuj akapitu i nie twórz pliku narzędziem plikowym ani terminalem. Pracuj wyłącznie w tych dwóch testowych oknach. Strona zawiera trzy akapity w zwykłym edytowalnym dokumencie przeglądarki. Odczytaj zapisany plik, aby sprawdzić wynik, i podaj jego treść w odpowiedzi.`;
    run.write('C-fixture.json', { source_title: sourceTitle, source_file: fixture, editor_command: `${env.tools.mousepad} --disable-server --opening-mode=window`, editor_pid: editor.pid, editor_initial_windows: editorWindows, destination: target, model_controlled: true, runner_performs_selection_copy_paste_save: false });
    await send(page, command);
    const started = performance.now(); let lastOracle;
    while (performance.now() - started < 240000) {
      const dialog = page.locator('.sheet').filter({ hasText: 'Zgoda na akcję' });
      if (await dialog.count()) {
        const name = await dialog.locator('.panel-body b').first().innerText();
        let input; try { input = await dialog.locator('pre').count() ? JSON.parse(await dialog.locator('pre').innerText()) : {}; } catch { input = {}; }
        editorWindows = observeEditor();
        const knownTitle = title => typeof title === 'string' && title.length >= 3 && [sourceTitle, ...editorWindows.map(w => w.title)].some(t => t.toLocaleLowerCase().includes(title.toLocaleLowerCase()));
        const combo = typeof input.combo === 'string' ? input.combo.toLowerCase() : '';
        const safeKey = /^(?:(?:ctrl|shift)\+){0,2}(?:home|end|up|down|left|right|tab|enter|esc|escape|c|v|s|a)$/.test(combo);
        let allowed = name === 'desktop_list_windows' || name === 'desktop_active_window';
        if (name === 'desktop_focus_window') allowed = knownTitle(input.title) && [sourceNativeId, ...editorWindows.map(w => w.id)].includes(String(input.id));
        const ownedFocus = [jarvisNativeId, sourceNativeId, ...editorWindows.map(w => w.id)].includes(nativeRead(['getactivewindow']));
        if (name === 'desktop_clipboard_read') allowed = ownedFocus;
        if (name === 'desktop_click') allowed = ownedFocus && knownTitle(input.window);
        if (name === 'desktop_hotkey') allowed = ownedFocus && knownTitle(input.window) && safeKey;
        if (name === 'desktop_type') allowed = ownedFocus && knownTitle(input.window) && [target, 'notatka.txt'].includes(input.text);
        if (name === 'system_files_read') allowed = typeof input.path === 'string' && path.resolve(workspace, input.path) === target;
        if (name === 'system_workspace_status') allowed = Object.keys(input).length === 0;
        const decisionAt = Date.now();
        consents.push({ tool: name, input, allowed, at: Date.now() });
        await dialog.getByRole('button', { name: allowed ? 'Zezwól' : 'Odmów', exact: true }).click();
        if (!allowed) throw Error(`C refused operation outside two test windows/native clipboard flow: ${name}`);
        if (name === 'desktop_hotkey' && combo === 'ctrl+v') {
          // Observe immediately after the native tool's recorded completion. The product
          // restores only its explicitly verified target from its own consent window.
          // QA never activates a window or dispatches the paste itself.
          for (let i = 0; i < 80; i++) {
            const snapshot = await stored(page);
            const completed = (snapshot.data.audit || []).some(a => {
              let input; try { input = typeof a.input === 'string' ? JSON.parse(a.input) : a.input; } catch { return false; }
              return a.at >= decisionAt && a.tool === 'desktop_hotkey' && a.status === 'ok' && input?.combo?.toLowerCase() === 'ctrl+v';
            });
            if (completed) {
              const copies = await source.evaluate(() => window.__qaCopies);
              pasteObservations.push({ editor_focused: editorWindows.some(w => w.id === nativeRead(['getactivewindow'])), clipboard: await app.evaluate(({ clipboard }) => clipboard.readText()), source_copy_observed: copies.some(c => c.trusted && c.focused && c.text === expected), at: Date.now(), observation: 'after native tool audit; not an exact OS event timestamp' });
              break;
            }
            await pause(25);
          }
        }
      }
      const snapshot = await stored(page), copies = await source.evaluate(() => window.__qaCopies);
      const audit = (snapshot.data.audit || []).filter(a => !beforeIds.has(a.id));
      const file = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
      lastOracle = clipboardOracle({ expected, copies, pasteObservations, file, audit, modelResponse: responses.some(r => r.status === 200), assistantReply: require('./agent-real.cjs').verifiedReply(snapshot.chats, command, expected) });
      if (lastOracle.passed && !await page.getByRole('button', { name: 'Zatrzymaj generowanie', exact: true }).count()) {
        run.write('C-result.json', { oracle: lastOracle, copies, pasteObservations, file, audit, responses, command, final_selection: await source.evaluate(() => window.getSelection()?.toString()) });
        run.record({ id: 'C', level: 'native X11 + actual Mousepad + real model', status: 'PASS', detail: 'Normal composer → real model/native JARVIS tools → trusted source copy, clipboard before paste, editor focus, native save and independent disk bytes. Only test fixtures were prepared by QA.', evidence: ['C-fixture.json', 'C-result.json', 'C-consents.json'] });
        return;
      }
      await pause(100);
    }
    run.write('C-oracle.json', lastOracle || {}); throw Error('C timeout: native clipboard/focus/save oracle did not confirm all required effects');
  } catch (error) {
    await page.getByRole('button', { name: 'STOP — zatrzymaj działania', exact: true }).click().catch(() => {});
    run.write('C-error.log', error.stack || error.message);
    run.record({ id: 'C', level: 'native X11 + actual Mousepad + real model', status: 'FAIL', detail: error.message, evidence: ['C-error.log', 'C-fixture.json', 'C-consents.json', 'C-oracle.json'] });
  } finally {
    run.write('C-consents.json', consents); page.removeListener('request', requestListener); page.removeListener('response', responseListener);
    // No global process kill and no clipboard restoration that could overwrite newer user data.
    if (sourceId) await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), sourceId).catch(() => {});
    await stop(editor);
  }
}
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
        if (ollama.stages.model === 'PASS' && ollama.stages.capabilities === 'PASS') {
          await require('./agent-real.cjs').runScenarios({ run, page, workspace });
          await runDesktopScenario({ run, app, page, workspace, env });
        }
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
    if (!run.results.some(r => r.id === 'C')) {
      const blocker = nativeBlocker || modelBlocker(ollama);
      blocked('C', 'Native clipboard/focus/save test is implemented but its environment prerequisites did not pass.', { ...blocker, scenarios: ['C'] });
    }
  } catch (e) { run.write('runner-error.txt', e.stack || e.message); run.record({ id: 'runner', level: 'runner', status: 'FAIL', detail: e.message, evidence: ['runner-error.txt'] }); }
  finally {
    let cleanupError = null;
    try { await cleanup(); } catch (e) { cleanupError = e.message; run.record({ id: 'cleanup', level: 'runner', status: 'FAIL', detail: e.message }); }
    run.write('cleanup.json', { only_owned_processes: true, completed: !cleanupError, error: cleanupError });
    complete(interrupted ? 130 : undefined); for (const [signal, handler] of Object.entries(signalHandlers)) process.removeListener(signal, handler);
  }
}
module.exports = { main, runDesktopScenario, clipboardOracle };
if (require.main === module) void main();
