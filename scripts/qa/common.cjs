const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function args(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills-controlled') { out['skills-controlled'] = true; continue; }
    if (!['--ollama-url', '--model', '--settings-file', '--chromium', '--license-file'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`Unknown or incomplete option: ${argv[i]}`);
    out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}
function localUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/') {
    throw Error('QA accepts only a local HTTP Ollama origin without credentials or paths.');
  }
  return u.origin;
}
function configuration(options, env = process.env) {
  let settings = {};
  if (options['settings-file']) {
    const file = JSON.parse(fs.readFileSync(path.resolve(options['settings-file']), 'utf8'));
    const raw = file['jarvis.settings.v2'] ?? file.settings ?? file;
    settings = typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  const url = options['ollama-url'] || env.QA_OLLAMA_URL || settings.ollamaUrl;
  const model = options.model || env.QA_OLLAMA_MODEL || (settings.provider === 'ollama' && settings.model !== 'auto' ? settings.model : '') || settings.ollamaModelSimple || '';
  return {
    candidates: url ? [localUrl(url)] : ['http://127.0.0.1:11435', 'http://127.0.0.1:11434'],
    url_source: options['ollama-url'] ? 'CLI --ollama-url (isolated test override)' : env.QA_OLLAMA_URL ? 'QA_OLLAMA_URL (isolated test override)' : url ? 'settings-file: ollamaUrl' : 'unresolved: no user profile available; bounded discovery of both known ports',
    model, model_source: options.model ? 'CLI --model' : env.QA_OLLAMA_MODEL ? 'QA_OLLAMA_MODEL' : model ? 'settings-file' : 'not selected; supply --model from installed models',
    production_settings_changed: false,
  };
}
function command(file, argv) {
  try { return execFileSync(file, argv, { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }).trim(); }
  catch { return null; }
}
function which(name) { return command('which', [name]); }
function dependencySnapshot() {
  const packages = {};
  for (const name of ['vite', 'playwright', 'electron']) {
    try { packages[name] = { available: true, version: require(`${name}/package.json`).version }; }
    catch { packages[name] = { available: false, action: 'Run npm ci in the transferred repository (Node >=20). No system installation is performed by QA.' }; }
  }
  let electronBinary = null;
  try { const file = require('electron'); if (typeof file === 'string' && fs.existsSync(file)) electronBinary = file; } catch { /* reported as dependency */ }
  return { node_supported: Number(process.versions.node.split('.')[0]) >= 20, packages, electron_binary: electronBinary };
}
function resultExitCode(results, required = ['A', 'B', 'C']) {
  if (results.some(r => r.status === 'FAIL')) return 1;
  if (required.some(id => !results.some(r => r.id === id && r.status === 'PASS')) || results.some(r => ['BLOCKED', 'NOT_RUN'].includes(r.status))) return 2;
  return 0;
}
function newRun(kind) {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}-${randomUUID().slice(0, 8)}`;
  const dir = path.join(root, 'QA/runs', id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  const untracked = (command('git', ['ls-files', '--others', '--exclude-standard']) || '').split('\n').filter(x => /^(src|electron|scripts\/qa)\//.test(x));
  const source = {
    repo: root, branch: command('git', ['branch', '--show-current']), commit: command('git', ['rev-parse', 'HEAD']),
    local_changes: command('git', ['status', '--short']),
    diff_sha256: createHash('sha256').update(command('git', ['diff', '--', 'src', 'electron', 'scripts', 'package.json', 'package-lock.json']) || '').digest('hex'),
    new_source_sha256: Object.fromEntries(untracked.map(x => [x, createHash('sha256').update(fs.readFileSync(path.join(root, x))).digest('hex')])),
    app_version: require('../../package.json').version, app_entry: 'electron/main.cjs -> dist/index.html',
  };
  write('source.json', source);
  const results = [];
  return { id, dir, write, results, source, record(result) { results.push(result); write('results.json', results); }, finish(extra = {}) {
    const report = { run_id: id, kind, finished_at: new Date().toISOString(), source, results, ...extra };
    write('report.json', report);
    const summary = extra.required_scenarios ? `Runner completed: ${extra.runner_completed}. Required tests passed: ${extra.required_tests_passed}. Exit code: ${extra.exit_code}.\nMode: ${extra.mode}. Ollama: ${extra.ollama_origin || 'not reachable / not selected'}; model: ${extra.ollama_model || 'not selected'}.\n\n` : '';
    write('REPORT.md', `# JARVIS QA ${id}\n\nVersion ${source.app_version}, ${source.branch}@${source.commit}. Uncommitted source is identified in source.json.\n\n` + summary + results.map(x => `- **${x.id} ${x.status}** [${x.level}] ${x.detail || ''} Evidence: ${(x.evidence || []).join(', ') || 'report.json'}.` + (x.blocker ? ` Unblock: ${x.blocker.action}` : '')).join('\n') + `\n\nModel fixtures: ${extra.model_fixtures || 'none'}. User desktop: not inferred from Chromium or Electron tests.\n`);
    console.log(`QA report: ${path.join(dir, 'REPORT.md')}`);
    return report;
  } };
}
function environment() {
  return {
    os: os.release(), platform: os.platform(), architecture: os.arch(), node: process.version,
    os_release: fs.existsSync('/etc/os-release') ? fs.readFileSync('/etc/os-release', 'utf8') : null,
    container_markers: { dockerenv: fs.existsSync('/.dockerenv'), containerenv: fs.existsSync('/run/.containerenv') }, cwd: root, uid: process.getuid?.(),
    session_present: Object.fromEntries(['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_SESSION_TYPE'].map(k => [k, !!process.env[k]])),
    session_bus_socket: !!(process.env.XDG_RUNTIME_DIR && fs.existsSync(path.join(process.env.XDG_RUNTIME_DIR, 'bus'))),
    tools: Object.fromEntries(['chromium', 'chromium-browser', 'Xvfb', 'xvfb-run', 'Xorg', 'xdotool', 'mousepad', 'ollama'].map(x => [x, which(x)])),
    electron_version: dependencySnapshot().packages.electron.version || null,
    actual_user_installation: 'Not inspected. This is the current test machine, not assumed to be /home/qw/Jarvis-GitHub.',
  };
}
async function jsonRequest(url, body, timeout = 3000) {
  try {
    const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeout), ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await r.json();
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, error: e.cause?.code || e.name, message: String(e.message).slice(0, 200) }; }
}
async function inspectOllama(config, run) {
  const probes = [];
  let selected;
  for (const origin of config.candidates) {
    const response = await jsonRequest(`${origin}/api/tags`);
    const models = response.data?.models;
    const valid = response.ok && Array.isArray(models) && models.every(x => typeof x.name === 'string');
    probes.push({ origin, command: `GET ${origin}/api/tags (3000ms)`, reachable: !!response.status, valid_model_list: valid, http_status: response.status, error: response.error, models: valid ? models.map(x => x.name) : [] });
    if (valid && !selected) selected = origin;
  }
  const out = { ...config, probes, selected_origin: selected || null, stages: { tags: selected ? 'PASS' : 'BLOCKED', model: 'NOT_RUN', capabilities: 'NOT_RUN', generation: 'NOT_RUN', jarvis_chat: 'NOT_RUN', jarvis_tool: 'NOT_RUN' } };
  if (selected) {
    const names = probes.find(x => x.origin === selected).models;
    out.stages.model = config.model && names.includes(config.model) ? 'PASS' : 'BLOCKED';
    if (out.stages.model === 'PASS') {
      const show = await jsonRequest(`${selected}/api/show`, { model: config.model });
      out.capabilities = Array.isArray(show.data?.capabilities) ? show.data.capabilities : [];
      out.context_lengths = Object.fromEntries(Object.entries(show.data?.model_info || {}).filter(([key]) => key.endsWith('.context_length')));
      out.stages.capabilities = show.ok && out.capabilities.includes('tools') ? 'PASS' : 'BLOCKED';
      out.show_http_status = show.status;
    }
  }
  run.write('ollama.json', out);
  return out;
}
function modelBlocker(ollama) {
  return { dependency: !ollama.selected_origin ? 'reachable configured Ollama API' : 'explicit installed model', command: ollama.probes.map(x => x.command), evidence: ['ollama.json'], scenarios: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'], action: !ollama.selected_origin ? 'Run in the machine/session with the existing local Ollama service; pass --ollama-url http://127.0.0.1:11435. Do not download a model for this test.' : 'Pass --model with an already installed model listed in ollama.json.' };
}
function ownedProcess(file, argv, options, run, logName) {
  const fd = fs.openSync(path.join(run.dir, logName), 'a', 0o600);
  const child = spawn(file, argv, { cwd: root, ...options, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  child.qaError = null;
  child.on('error', e => { child.qaError = e.message; });
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode || child.qaError) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 20 && child.exitCode === null && !child.signalCode; i++) await pause(100);
  if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
}
module.exports = { fs, path, root, args, configuration, newRun, environment, inspectOllama, modelBlocker, jsonRequest, which, pause, ownedProcess, stop, dependencySnapshot, resultExitCode };
