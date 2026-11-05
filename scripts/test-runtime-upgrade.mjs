#!/usr/bin/env node
// Real runtime processes and HTTP; systemctl is an isolated test double.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readlink, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
let installer = path.join(root, 'scripts/install-runtime.sh');
let baselineRef = '857def1';
let oldSource;
let onlyCase;
for (let index = 2; index < process.argv.length; index++) {
  const separator = process.argv[index].indexOf('=');
  const argument = separator < 0 ? process.argv[index] : process.argv[index].slice(0, separator);
  if (argument === '--help') {
    console.log('Usage: node scripts/test-runtime-upgrade.mjs [--installer PATH] [--baseline-ref REF | --old-runtime-source PATH] [--case NAME]\nRequires Linux, Node 20+, a legacy runtime source (default git ref 857def1), and loopback sockets.\nFor shallow/squashed history, provide a directory containing the old cli.mjs/server.mjs, or fetch the old revision explicitly.\nAll services, data and logs are isolated under a temporary directory; no real systemd service or Ollama is used.');
    process.exit(0);
  }
  const value = separator < 0 ? process.argv[++index] : process.argv[index].slice(separator + 1);
  assert(value, `Missing value for ${argument}.`);
  if (argument === '--installer') installer = path.resolve(value);
  else if (argument === '--baseline-ref') baselineRef = value;
  else if (argument === '--old-runtime-source') oldSource = path.resolve(value);
  else if (argument === '--case') onlyCase = value;
  else throw new Error(`Unknown option: ${argument}`);
}
assert.equal(process.platform, 'linux', 'Runtime upgrade tests require Linux.');
assert(process.getuid() !== 0, 'Run as a normal user, without sudo.');

const temp = await mkdtemp(path.join(os.tmpdir(), 'jarvis-runtime-upgrade-'));
const legacy = path.join(temp, 'legacy');
const current = path.join(root, 'server/runtime');
const contexts = [];
const passed = [];
const currentVersion = (await readFile(path.join(current, 'server.mjs'), 'utf8')).match(/export const VERSION = ['"]([^'"]+)['"]/)[1];
let legacyVersion;

async function until(check, timeout = 10000, message = 'Timed out waiting for runtime.') {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(message);
}

function run(command, args, env, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${path.basename(command)} exceeded ${timeout} ms.`)); }, timeout);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

async function connection(context) {
  return JSON.parse(await readFile(path.join(context.data, 'connection.json'), 'utf8'));
}
async function status(context, discovery) {
  const conn = discovery || await connection(context);
  const response = await fetch(`${conn.url}/v1/status`, {
    headers: { Authorization: `Bearer ${conn.token}` }, signal: AbortSignal.timeout(1000), redirect: 'error',
  });
  assert.equal(response.status, 200, 'Authenticated runtime status must succeed.');
  return response.json();
}
async function waitStatus(context, version) {
  let found;
  await until(async () => {
    try { found = await status(context); return !version || found.version === version; }
    catch { return false; }
  }, 10000, `Runtime ${version || ''} did not become available.`);
  return found;
}
async function install(context, source, args = []) {
  return run('bash', [installer, ...args], { ...context.env, JARVIS_RUNTIME_SOURCE_DIR: source });
}
function assertInstalled(result) {
  assert.equal(result.code, 0, `Installer failed:\n${result.stdout}\n${result.stderr}`);
}

const fakeSystemctl = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const stateFile = process.env.JARVIS_TEST_SYSTEMD_STATE;
const args = process.argv.slice(2).filter(arg => arg !== '--user');
const command = args.find(arg => !arg.startsWith('-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = () => { try { return JSON.parse(fs.readFileSync(stateFile,'utf8')); } catch { return {enabled:false,pid:null}; } };
let state = read();
fs.appendFileSync(stateFile+'.calls',args.join(' ')+'\\n');
const alive = pid => {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8'); return !/^Z/.test(stat.slice(stat.lastIndexOf(')')+2)); } catch { return false; }
};
async function stop() {
  if (alive(state.pid)) { try {process.kill(state.pid,'SIGTERM');} catch {} }
  const end=Date.now()+5000; while(alive(state.pid) && Date.now()<end) await delay(20);
  if (alive(state.pid)) throw new Error('Mock service did not stop');
  state.pid=null;
}
async function start() {
  const log=fs.openSync(stateFile+'.log','a',0o600);
  const child=spawn(process.env.JARVIS_TEST_RUNTIME_WRAPPER,['start'],{env:process.env,detached:true,stdio:['ignore',log,log]});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  state.pid=child.pid; child.unref(); fs.closeSync(log);
}
(async()=>{
  if (command==='show-environment') return process.exit(process.env.JARVIS_TEST_SYSTEMD==='1'?0:1);
  if (command==='is-active') return process.exit(alive(state.pid)?0:3);
  if (command==='is-enabled') return process.exit(state.enabled?0:1);
  if (command==='show') {
    if(args.some(a=>a.includes('MainPID'))) console.log(state.pid||0);
    else if(args.some(a=>a.includes('FragmentPath'))) console.log(path.join(process.env.XDG_CONFIG_HOME,'systemd/user/jarvis-runtime.service'));
    else console.log('loaded');
    return;
  }
  if(command==='enable') state.enabled=true;
  if(command==='disable') state.enabled=false;
  if(command==='stop' || command==='restart') await stop();
  if(command==='start' || command==='restart') await start();
  fs.writeFileSync(stateFile,JSON.stringify(state));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
`;

async function createContext(name, systemd) {
  const dir = path.join(temp, `${name} space % $literal`);
  const data = path.join(dir, 'data');
  const mock = path.join(dir, 'mock');
  await mkdir(mock, { recursive: true });
  await writeFile(path.join(mock, 'systemctl'), fakeSystemctl, { mode: 0o755 });
  const bin = path.join(dir, 'bin');
  const env = {
    ...process.env, PATH: `${mock}${path.delimiter}${process.env.PATH}`,
    JARVIS_INSTALL_DIR: path.join(dir, 'app'), JARVIS_BIN_DIR: bin, JARVIS_RUNTIME_DATA_DIR: data,
    XDG_CONFIG_HOME: path.join(dir, 'config'), XDG_STATE_HOME: path.join(dir, 'state'),
    JARVIS_RUNTIME_PORT: '0', JARVIS_RUNTIME_AUTO_DISCOVER: '0', JARVIS_RUNTIME_AUTO_PROBE: '0',
    JARVIS_TEST_SYSTEMD: systemd ? '1' : '0', JARVIS_TEST_SYSTEMD_STATE: path.join(dir, 'systemd.json'),
    JARVIS_TEST_RUNTIME_WRAPPER: path.join(bin, 'jarvis-runtime'),
  };
  delete env.JARVIS_RUNTIME_MODEL;
  delete env.JARVIS_RUNTIME_OLLAMA_URL;
  const context = { dir, data, env, children: [], wrapper: path.join(bin, 'jarvis-runtime'), systemd };
  contexts.push(context);
  assertInstalled(await install(context, legacy, ['--no-start']));
  const now = new Date().toISOString();
  context.job = { id: randomUUID(), prompt: 'Preserve this completed result', idempotencyKey: 'upgrade-preserve-result', status: 'completed', createdAt: now, updatedAt: now, attempt: 1, profileVersion: 1, model: 'fixture-only', ollamaUrl: 'http://127.0.0.1:9', execution: 'local-analysis', result: 'Persisted before upgrade' };
  const cancelled = { ...context.job, id: randomUUID(), idempotencyKey: 'upgrade-preserve-cancelled', status: 'cancelled', attempt: 0 };
  delete cancelled.result;
  context.jobs = [context.job, cancelled];
  context.serverId = randomUUID();
  await writeFile(path.join(data, 'state.json'), JSON.stringify({ schemaVersion: 1, serverId: context.serverId, jobs: context.jobs }), { mode: 0o600 });
  await writeFile(path.join(data, 'profile.json'), JSON.stringify({ version: 1, policy: 'local_only', model: '', ollamaUrl: 'http://127.0.0.1:9' }), { mode: 0o600 });
  return context;
}
async function startLegacy(context, managed = false, source = legacy) {
  if (managed) {
    assert.equal((await run('systemctl', ['--user', 'start', 'jarvis-runtime.service'], context.env)).code, 0);
  } else {
    const child = spawn(process.execPath, [path.join(source, 'cli.mjs'), 'start'], { env: context.env, stdio: 'ignore' });
    context.children.push(child);
  }
  await waitStatus(context, legacyVersion);
  context.original = await connection(context);
  context.token = await readFile(path.join(context.data, 'token'), 'utf8');
  context.previousLink = await readlink(path.join(context.env.JARVIS_INSTALL_DIR, 'runtime'));
}
async function assertPreserved(context) {
  const state = JSON.parse(await readFile(path.join(context.data, 'state.json'), 'utf8'));
  assert.equal(state.serverId, context.serverId, 'Server identity must survive upgrade.');
  assert.deepEqual(state.jobs, context.jobs, 'Existing jobs, cancellations and completed results must survive upgrade.');
  assert((await readFile(path.join(context.data, 'token'), 'utf8')) === context.token, 'Authentication token must survive upgrade.');
}

async function ownedPids() {
  const owned = [];
  for (const id of await readdir('/proc')) {
    if (!/^\d+$/.test(id)) continue;
    try {
      const args = (await readFile(`/proc/${id}/cmdline`, 'utf8')).split('\0');
      if (!args.includes('start') || !args.some(value => value.endsWith('/cli.mjs'))) continue;
      const env = (await readFile(`/proc/${id}/environ`, 'utf8')).split('\0');
      if (contexts.some(context => env.includes(`JARVIS_RUNTIME_DATA_DIR=${context.data}`))) owned.push(Number(id));
    } catch { /* process already exited or is not ours */ }
  }
  return owned;
}
async function cleanup() {
  for (const context of contexts.reverse()) {
    try {
      const conn = await connection(context);
      await fetch(`${conn.url}/v1/stop`, { method: 'POST', headers: { Authorization: `Bearer ${conn.token}` }, signal: AbortSignal.timeout(1000) });
    } catch { /* failed installs may not have discovery */ }
    for (const child of context.children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  // Failure cleanup is restricted to CLI processes carrying this test's unique data paths.
  for (const pid of await ownedPids()) { try { process.kill(pid, 'SIGTERM'); } catch { /* exited */ } }
  try { await until(async () => (await ownedPids()).length === 0, 3000, 'Runtime cleanup timed out.'); }
  catch {
    for (const pid of await ownedPids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* exited */ } }
    await until(async () => (await ownedPids()).length === 0, 2000, 'Runtime cleanup failed.');
  }
  await rm(temp, { recursive: true, force: true });
}

async function noStart(systemd) {
  const context = await createContext(systemd ? 'no-start-systemd' : 'no-start', systemd);
  await startLegacy(context, systemd);
  assertInstalled(await install(context, current, ['--no-start']));
  assert.equal((await status(context)).version, legacyVersion);
  assert.equal((await connection(context)).pid, context.original.pid, '--no-start must not interrupt ongoing work.');
  await assertPreserved(context);
}

const cases = {
  'no-systemd': async () => {
    const context = await createContext('no-systemd', false);
    await startLegacy(context);
    assertInstalled(await install(context, current));
    const upgraded = await status(context);
    assert.equal(upgraded.version, currentVersion, 'Installer must not report success while the old detached runtime still serves requests.');
    assert.equal(upgraded.capabilities.requestLookup, true);
    assert.equal(upgraded.capabilities.serverIdentityGuard, true);
    assert.notEqual((await connection(context)).pid, context.original.pid);
    await assertPreserved(context);
  },
  systemd: async () => {
    const context = await createContext('systemd', true);
    await startLegacy(context);
    assertInstalled(await install(context, current));
    const upgraded = await status(context);
    assert.equal(upgraded.version, currentVersion, 'A new service must replace the legacy detached process, not reuse its healthy endpoint.');
    assert.equal(upgraded.capabilities.requestLookup, true);
    const service = JSON.parse(await readFile(context.env.JARVIS_TEST_SYSTEMD_STATE, 'utf8'));
    assert.equal((await connection(context)).pid, service.pid, 'The verified process must be the new managed service.');
    await assertPreserved(context);
  },
  'managed-systemd': async () => {
    const context = await createContext('managed-systemd', true);
    await startLegacy(context, true);
    assertInstalled(await install(context, current));
    const upgraded = await status(context);
    assert.equal(upgraded.version, currentVersion);
    assert.equal(upgraded.capabilities.serverIdentityGuard, true);
    assert.notEqual((await connection(context)).pid, context.original.pid);
    await assertPreserved(context);
  },
  'no-start': async () => noStart(false),
  'no-start-systemd': async () => noStart(true),
  'rollback-detached': async () => rollback(false),
  'rollback-systemd': async () => rollback(true),
  'rollback-managed': async () => rollback(true, true),
  'missing-legacy-code': async () => {
    const context = await createContext('missing-legacy-code', false);
    const extracted = path.join(context.dir, 'temporary-appimage-runtime');
    await cp(legacy, extracted, { recursive: true });
    await startLegacy(context, false, extracted);
    await rm(extracted, { recursive: true, force: true });
    await rm(path.join(context.env.JARVIS_INSTALL_DIR, context.previousLink), { recursive: true, force: true });
    const rejected = await install(context, current);
    assert.notEqual(rejected.code, 0, 'An upgrade without restorable legacy code must refuse before stopping the process.');
    assert.match(rejected.stderr, /Brak odtwarzalnego kodu/);
    assert.equal((await status(context)).version, legacyVersion);
    assert.equal((await connection(context)).pid, context.original.pid, 'A non-restorable legacy process must remain alive.');
    await assertPreserved(context);
  },
  'identity-mismatch': async () => {
    const context = await createContext('identity-a', false);
    const foreign = await createContext('identity-b', false);
    await startLegacy(context); await startLegacy(foreign);
    const backups = new Map();
    for (const file of ['connection.json', 'token', 'state.json', 'runtime.lock']) {
      backups.set(file, await readFile(path.join(context.data, file)));
      await writeFile(path.join(context.data, file), await readFile(path.join(foreign.data, file)), { mode: 0o600 });
    }
    const rejected = await install(context, current);
    assert.notEqual(rejected.code, 0, 'An unrelated runtime must never be stopped through copied discovery.');
    assert.equal((await status(foreign)).version, legacyVersion);
    assert.equal((await status(context, context.original)).version, legacyVersion);
    for (const [file, contents] of backups) await writeFile(path.join(context.data, file), contents, { mode: 0o600 });
    await assertPreserved(context); await assertPreserved(foreign);
  },
};

async function rollback(systemd, managed = false) {
  const context = await createContext(managed ? 'rollback-managed' : systemd ? 'rollback-systemd' : 'rollback-detached', systemd);
  await startLegacy(context, managed);
  const broken = path.join(context.dir, 'broken-runtime');
  await cp(current, broken, { recursive: true });
  await writeFile(path.join(broken, 'cli.mjs'), 'process.exitCode = 17;\n');
  const rejected = await install(context, broken);
  assert.notEqual(rejected.code, 0, 'Failed replacement startup must not report success.');
  await waitStatus(context, legacyVersion);
  assert.equal(await readlink(path.join(context.env.JARVIS_INSTALL_DIR, 'runtime')), context.previousLink);
  await assertPreserved(context);
}

try {
  await mkdir(legacy);
  if (oldSource) {
    for (const file of await readdir(oldSource, { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.mjs')) await cp(path.join(oldSource, file.name), path.join(legacy, file.name));
    }
    await readFile(path.join(legacy, 'cli.mjs'));
  } else {
    for (const file of ['cli.mjs', 'server.mjs']) {
      let source;
      try { source = execFileSync('git', ['show', `${baselineRef}:server/runtime/${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch { throw new Error(`Legacy runtime ${baselineRef} is unavailable. Fetch its history (for example git fetch --unshallow origin on a shallow clone), pass --baseline-ref REF, or provide --old-runtime-source PATH with the old cli.mjs/server.mjs. No cases were skipped.`); }
      await writeFile(path.join(legacy, file), source);
    }
  }
  legacyVersion = (await readFile(path.join(legacy, 'server.mjs'), 'utf8')).match(/export const VERSION = ['"]([^'"]+)['"]/)?.[1];
  assert(legacyVersion && legacyVersion !== currentVersion, 'The legacy source must export a runtime version different from the current version.');
  if (onlyCase) assert(cases[onlyCase], `Unknown case ${onlyCase}.`);
  for (const [name, test] of Object.entries(cases)) {
    if (onlyCase && onlyCase !== name) continue;
    await test(); passed.push(name); console.log(`PASS ${name}`);
  }
  console.log(JSON.stringify({ passed: passed.length, cases: passed, legacySource: oldSource ? 'EXPLICIT_LOCAL_DIRECTORY' : baselineRef, legacyVersion, targetVersion: currentVersion, realRuntime: true, systemd: 'SIMULATED_SERVICE_MANAGER', model: 'NOT_USED' }));
} finally {
  await cleanup();
}
