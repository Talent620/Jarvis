// Executable skills run only behind a successfully probed Linux namespace + seccomp boundary.
// No Docker socket, host home, host network, writable host mount, inherited env or shell.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const nodeCrypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const MAX_FILES = 128, MAX_BYTES = 2 * 1024 * 1024, MAX_DEPTH = 8;
const DEFAULT_LIMITS = Object.freeze({ timeoutMs: 5000, cpuSeconds: 2, memoryMb: 1024, fileBytes: 1024 * 1024, outputBytes: 128 * 1024, scratchBytes: 8 * 1024 * 1024 });
const failure = (message, code = 'INVALID_INPUT') => Object.assign(new Error(message), { code });
const sha = value => nodeCrypto.createHash('sha256').update(value).digest('hex');
function limitsOf(raw = {}) {
  const result = { ...DEFAULT_LIMITS };
  const floors = { timeoutMs: 50, cpuSeconds: 1, memoryMb: 256, fileBytes: 1024, outputBytes: 1024, scratchBytes: 1024 * 1024 };
  for (const [key, maximum] of Object.entries(DEFAULT_LIMITS)) if (raw[key] !== undefined) {
    if (!Number.isSafeInteger(raw[key]) || raw[key] < floors[key] || raw[key] > maximum) throw failure(`Niepoprawny limit ${key}.`);
    result[key] = raw[key];
  }
  return result;
}
function entryOf(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^[a-zA-Z0-9_./-]+\.(?:cjs|mjs|js)$/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(value)) throw failure('Wymagany względny plik Node.js w paczce.', 'ENTRY_INVALID');
  return value;
}

function openPinnedDirectory(directory) {
  if (process.platform !== 'linux' || !path.isAbsolute(directory || '')) throw failure('Izolacja plików skilla wymaga Linux i pełnej ścieżki.', 'UNSUPPORTED_PLATFORM');
  let fd = fs.openSync('/', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    for (const part of path.resolve(directory).split('/').filter(Boolean)) {
      const next = fs.openSync(`/proc/self/fd/${fd}/${part}`, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      fs.closeSync(fd); fd = next;
    }
    return fd;
  } catch (error) { fs.closeSync(fd); throw error; }
}
function readBoundedFile(location, maxBytes) {
  const file = fs.openSync(location, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(file);
    if (!before.isFile() || before.nlink !== 1) throw failure('Zasób specjalny lub twarde dowiązanie.', 'UNSAFE_PATH');
    if (before.size > maxBytes) throw failure('Zasób przekracza limit odczytu.', 'RESOURCE_LIMIT');
    const data = Buffer.alloc(maxBytes + 1); let length = 0, count;
    while (length < data.length && (count = fs.readSync(file, data, length, data.length - length, null)) > 0) length += count;
    const after = fs.fstatSync(file);
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.nlink !== 1 || length > maxBytes) throw failure('Zasób zmienił się podczas odczytu.', 'HASH_MISMATCH');
    return data.subarray(0, length);
  } finally { fs.closeSync(file); }
}
/** Bounded source read: all root and relative parent components stay pinned, never followed. */
function readSkillFile(directory, relative, maxBytes = 1024 * 1024) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw failure('Niebezpieczna ścieżka zasobu.', 'UNSAFE_PATH');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) throw failure('Niepoprawny limit odczytu.');
  let fd = openPinnedDirectory(directory);
  const parts = relative.split('/');
  try {
    for (const part of parts.slice(0, -1)) { const next = fs.openSync(`/proc/self/fd/${fd}/${part}`, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); fs.closeSync(fd); fd = next; }
    return readBoundedFile(`/proc/self/fd/${fd}/${parts.at(-1)}`, maxBytes);
  } finally { fs.closeSync(fd); }
}

/** Pinned directory FDs + O_NOFOLLOW prevent a replaced parent/symlink from exposing host files. */
function snapshotDirectory(directory, destination) {
  const files = []; let total = 0;
  const visit = (fd, relative, depth) => {
    try {
      if (depth > MAX_DEPTH) throw failure('Przekroczono głębokość skilla.', 'RESOURCE_LIMIT');
      const anchored = `/proc/self/fd/${fd}`;
      for (const name of fs.readdirSync(anchored).sort()) {
        if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw failure('Niepoprawna ścieżka zasobu.', 'UNSAFE_PATH');
        const source = `${anchored}/${name}`, next = relative ? `${relative}/${name}` : name;
        const stat = fs.lstatSync(source);
        if (stat.isSymbolicLink()) throw failure('Dowiązania w skillu są zabronione.', 'UNSAFE_PATH');
        if (stat.isDirectory()) { visit(fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW), next, depth + 1); continue; }
        if (!stat.isFile() || stat.nlink !== 1) throw failure('Skill zawiera specjalny plik lub twarde dowiązanie.', 'UNSAFE_PATH');
        if (files.length >= MAX_FILES || stat.size + total > MAX_BYTES) throw failure('Skill przekracza limit 128 plików / 2 MiB.', 'RESOURCE_LIMIT');
        const body = readBoundedFile(source, MAX_BYTES - total);
        files.push({ path: next, sha256: sha(body), size: body.length }); total += body.length;
        if (destination) { const target = path.join(destination, next); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.writeFileSync(target, body, { flag: 'wx', mode: 0o400 }); }
      }
    } finally { fs.closeSync(fd); }
  };
  visit(openPinnedDirectory(directory), '', 0);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { hash: sha(JSON.stringify(files)), files, bytes: total };
}
function hashSkillDirectory(directory) { return snapshotDirectory(directory).hash; }

/** x86_64 seccomp: no child processes, new namespaces, mounts, ptrace or privileged kernel APIs.
 * clone(CLONE_THREAD) is needed by Node/libuv. clone3 returns ENOSYS so libc uses checked clone.
 * A single process shares address-space and CPU rlimits across its threads.
 */
function seccompFilter() {
  if (process.arch !== 'x64') throw failure('Backend seccomp wymaga obecnie Linux x86_64.', 'UNSUPPORTED_PLATFORM');
  const instructions = [];
  const ins = (code, jt, jf, value) => instructions.push({ code, jt, jf, value });
  const ret = value => ins(0x06, 0, 0, value);
  ins(0x20, 0, 0, 4); ins(0x15, 1, 0, 0xc000003e); ret(0x80000000);
  ins(0x20, 0, 0, 0); ins(0x35, 0, 1, 0x40000000); ret(0x80000000);
  // Anonymous shared-memory files/queues could otherwise consume memory outside
  // both RLIMIT_AS and the bounded /work tmpfs. Native addons are disabled too.
  for (const syscall of [29, 30, 31, 57, 58, 67, 68, 69, 70, 71, 101, 155, 165, 166, 240, 241, 242, 243, 244, 245, 248, 249, 250, 272, 298, 304, 308, 310, 311, 319, 321, 323, 425, 428, 429, 430, 431, 432, 438, 442, 447]) { ins(0x15, 0, 1, syscall); ret(0x00050001); }
  ins(0x15, 0, 1, 435); ret(0x00050026); // ENOSYS clone3, not EPERM (libc fallback).
  ins(0x15, 0, 4, 56); ins(0x20, 0, 0, 16); ins(0x45, 1, 0, 0x10000); ret(0x00050001); ret(0x7fff0000);
  ret(0x7fff0000);
  const buffer = Buffer.alloc(instructions.length * 8);
  instructions.forEach((i, n) => { buffer.writeUInt16LE(i.code, n * 8); buffer[n * 8 + 2] = i.jt; buffer[n * 8 + 3] = i.jf; buffer.writeUInt32LE(i.value >>> 0, n * 8 + 4); });
  return buffer;
}

function runtimeFiles(nodeBinary) {
  const output = spawnSync('/usr/bin/ldd', [nodeBinary], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin', LANG: 'C' } });
  if (output.error || output.status !== 0 || /not found/.test(output.stdout)) throw failure('Nie można ustalić bibliotek zaufanego Node.js.', 'RUNTIME_MISSING');
  const libraries = [...new Set([...output.stdout.matchAll(/(?:=>\s*)?(\/[^\s()]+)/g)].map(m => m[1]))];
  if (!libraries.length || libraries.some(file => !/^\/(?:lib|usr\/lib)/.test(file))) throw failure('Nieobsługiwane zależności Node.js.', 'RUNTIME_MISSING');
  return libraries.map(file => ({ source: fs.realpathSync(file), target: file }));
}
function nodePath(options) {
  const candidates = options.nodeBinary ? [options.nodeBinary] : process.versions.electron ? ['/usr/bin/node', '/usr/local/bin/node'] : [process.execPath];
  const value = candidates.find(candidate => typeof candidate === 'string' && path.isAbsolute(candidate) && fs.existsSync(candidate));
  if (!value) throw failure('Brak systemowego Node.js do izolowanego skilla.', 'RUNTIME_MISSING');
  return fs.realpathSync(value);
}

function createSkillIsolation(options = {}) {
  const active = new Map(); let cached = null;
  const config = () => {
    if (process.platform !== 'linux' || process.arch !== 'x64') throw failure('Backend wymaga Linux x86_64.', 'UNSUPPORTED_PLATFORM');
    const node = nodePath(options);
    for (const file of ['/usr/bin/bwrap', '/usr/bin/prlimit', node]) fs.accessSync(file, fs.constants.X_OK);
    return { node, libraries: runtimeFiles(node) };
  };
  const kill = child => { if (!child.pid) return; try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already exited */ } } };
  async function execute(request, runtime) {
    if (request.signal?.aborted) return { ok: false, status: 'CANCELLED', output: '', evidence: { started: false } };
    const entrypoint = entryOf(request.entrypoint), limits = limitsOf(request.limits);
    const input = JSON.stringify(request.input ?? null);
    if (Buffer.byteLength(input) > 128 * 1024) throw failure('Wejście skilla przekracza 128 KiB.', 'RESOURCE_LIMIT');
    if (!/^[a-f0-9]{64}$/.test(request.hash || '')) throw failure('Uruchomienie wymaga przypiętego hasha.', 'HASH_REQUIRED');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-skill-run-'));
    let filterFd;
    try {
      const snapshot = path.join(temporary, 'snapshot'); fs.mkdirSync(snapshot, { mode: 0o700 });
      const content = snapshotDirectory(request.directory, snapshot);
      if (content.hash !== request.hash) throw failure('Hash skilla zmienił się przed wykonaniem.', 'HASH_MISMATCH');
      if (!content.files.some(file => file.path === entrypoint)) throw failure('Brak pliku wejściowego skilla.', 'ENTRY_MISSING');
      const filter = path.join(temporary, 'seccomp'); fs.writeFileSync(filter, seccompFilter(), { mode: 0o600 }); filterFd = fs.openSync(filter, 'r'); fs.unlinkSync(filter);
      const arguments_ = [`--as=${limits.memoryMb * 1024 * 1024}`, `--cpu=${limits.cpuSeconds}`, `--fsize=${limits.fileBytes}`, '--nofile=64', '--nproc=4096', '--core=0', '--', '/usr/bin/bwrap',
        '--unshare-all', '--unshare-user', '--unshare-pid', '--unshare-net', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--hostname', 'jarvis-skill', '--clearenv',
        '--setenv', 'PATH', '/runtime', '--setenv', 'HOME', '/work', '--setenv', 'TMPDIR', '/tmp', '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'TZ', 'UTC',
        '--ro-bind', runtime.node, '/runtime/node', ...runtime.libraries.flatMap(lib => ['--ro-bind', lib.source, lib.target]), '--ro-bind', snapshot, '/skill',
        '--proc', '/proc', '--dev', '/dev', '--remount-ro', '/dev', '--size', String(limits.scratchBytes), '--tmpfs', '/tmp', '--size', String(limits.scratchBytes), '--tmpfs', '/work',
        '--remount-ro', '/', '--chdir', '/work', '--seccomp', '3', '--', '/runtime/node', '--jitless', '--no-addons', '--max-old-space-size=64', `/skill/${entrypoint}`];
      return await new Promise(resolve => {
        let stdout = '', stderr = '', bytes = 0, ended = false, reason = null;
        const started = Date.now();
        const child = spawn('/usr/bin/prlimit', arguments_, { shell: false, detached: true, env: { PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' }, stdio: ['pipe', 'pipe', 'pipe', filterFd] });
        const abort = () => { reason = 'CANCELLED'; kill(child); };
        active.set(child, abort);
        const timer = setTimeout(() => { reason = 'TIMEOUT'; kill(child); }, limits.timeoutMs);
        const finish = (code, signal, error) => {
          if (ended) return; ended = true; clearTimeout(timer); request.signal?.removeEventListener('abort', abort); active.delete(child);
          resolve({ ok: !reason && !error && code === 0, status: reason || (error ? 'EXTERNAL_BLOCKER' : code === 0 ? 'COMPLETED' : 'FAILED'), output: stdout, stderr,
            evidence: { backend: 'bubblewrap-seccomp-node', hash: content.hash, entrypoint, taskId: request.taskId || null, started: true, code, signal, error: error?.code || null, elapsedMs: Date.now() - started, limits, network: 'isolated namespace', hostWritableMounts: [], childProcesses: 'denied by seccomp', memoryLimit: 'RLIMIT_AS shared by all threads; not an RSS measurement' } });
        };
        const collect = (channel, buffer) => { bytes += buffer.length; if (bytes > limits.outputBytes) { reason = 'OUTPUT_LIMIT'; kill(child); return; } if (channel === 'stdout') stdout += buffer.toString(); else stderr += buffer.toString(); };
        child.stdout.on('data', data => collect('stdout', data)); child.stderr.on('data', data => collect('stderr', data));
        child.on('error', error => finish(null, null, error)); child.on('close', (code, signal) => finish(code, signal));
        child.stdin.on('error', () => {}); child.stdin.end(input);
        request.signal?.addEventListener('abort', abort, { once: true }); if (request.signal?.aborted) abort();
      });
    } finally { if (filterFd !== undefined) fs.closeSync(filterFd); fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  async function probe({ force = false } = {}) {
    if (!force && cached && cached.expiresAt > Date.now()) return { ...cached };
    const now = Date.now(); let temporary;
    try {
      const runtime = config(); temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-skill-probe-'));
      const directory = path.join(temporary, 'skill'); fs.mkdirSync(directory, { mode: 0o700 });
      const secret = path.join(temporary, 'outside-secret'); fs.writeFileSync(secret, nodeCrypto.randomBytes(32), { mode: 0o600 });
      fs.writeFileSync(path.join(directory, 'probe.cjs'), `const fs=require('node:fs'),cp=require('node:child_process'),net=require('node:net');let denied=false;try{fs.readFileSync(${JSON.stringify(secret)})}catch{denied=true}const child=cp.spawnSync('/runtime/node',['-e','process.exit(0)']);const socket=net.connect({host:'192.0.2.1',port:80});socket.setTimeout(300,()=>socket.destroy());socket.on('connect',()=>{console.log('NETWORK_LEAK');process.exit(9)});socket.on('error',()=>{});socket.on('close',()=>console.log(JSON.stringify({denied,childDenied:child.error?.code==='EPERM',envClean:!process.env.GH_TOKEN&&!process.env.NODE_OPTIONS,networkDenied:true,limits:fs.readFileSync('/proc/self/limits','utf8').includes('Max address space')})));`);
      const result = await execute({ directory, entrypoint: 'probe.cjs', hash: hashSkillDirectory(directory) }, runtime);
      let evidence; try { evidence = JSON.parse(result.output.trim()); } catch { /* malformed output is not isolation proof */ }
      const ok = result.ok && evidence?.denied === true && evidence?.childDenied === true && evidence?.envClean === true && evidence?.networkDenied === true && evidence?.limits === true;
      cached = { ok, available: ok, status: ok ? 'AVAILABLE' : 'EXTERNAL_BLOCKER', backend: 'bubblewrap-seccomp-node', checkedAt: now, expiresAt: now + (ok ? 60000 : 5000), evidence: result.evidence, reason: ok ? null : result.stderr.trim().slice(0, 400) || 'Funkcjonalna próba izolacji nie została zaliczona.' };
    } catch (error) { cached = { ok: false, available: false, status: 'EXTERNAL_BLOCKER', code: error.code || 'ISOLATION_UNAVAILABLE', checkedAt: now, expiresAt: now + 5000, reason: error.code === 'ENOENT' ? 'Wymagane istniejące bwrap, prlimit i Node.js; niczego nie zainstalowano.' : error.message }; }
    finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
    return { ...cached };
  }
  async function run(request) {
    const capability = await probe();
    if (!capability.ok) return { ok: false, status: 'EXTERNAL_BLOCKER', code: 'ISOLATION_UNAVAILABLE', output: '', evidence: capability };
    try { return await execute(request, config()); }
    catch (error) { return { ok: false, status: 'REJECTED', code: error.code || 'EXECUTION_REJECTED', output: '', error: error.message }; }
  }
  async function test(request) {
    const result = await run(request);
    if (request.expectedOutput !== undefined && result.ok) {
      const expected = typeof request.expectedOutput === 'string' ? request.expectedOutput : JSON.stringify(request.expectedOutput);
      if (result.output.trim() !== expected.trim()) return { ...result, ok: false, status: 'FAILED', error: 'Wyjście nie zgadza się z zadeklarowanym testem.' };
    }
    return { ...result, evidence: { ...result.evidence, verificationScope: request.expectedOutput === undefined ? 'bounded execution/exit only; no task correctness claim' : 'declared exact output assertion; not a safety certificate' } };
  }
  function cancelAll() { const count = active.size; for (const abort of active.values()) abort(); return { cancelled: count }; }
  return { probe, test, run, cancelAll };
}
module.exports = { createSkillIsolation, hashSkillDirectory, snapshotDirectory, readSkillFile, limitsOf, DEFAULT_LIMITS };
