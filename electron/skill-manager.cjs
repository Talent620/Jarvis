// Native Agent Skills lifecycle. Source instructions are data; this module never evaluates them.
const fs = require('node:fs').promises;
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const { spawn } = require('node:child_process');
const yaml = require('js-yaml');
const flags = require('node:fs').constants;

const SOURCES = ['openai/plugins', 'openai/skills', 'anthropics/skills', 'obra/superpowers', 'vercel-labs/skills'];
const MAX_FILE = 1024 * 1024, MAX_PACKAGE = 2 * MAX_FILE, MAX_FILES = 128;
const digest = value => nodeCrypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const error = (message, code = 'INVALID_SKILL') => Object.assign(new Error(message), { code });
const abort = signal => { if (signal?.aborted) throw error('Operacja umiejętności anulowana.', 'ABORTED'); };
function safePath(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || value.split('/').some(p => !p || p === '.' || p === '..')) throw error('Niebezpieczna ścieżka zasobu.');
  return value;
}
function boundedData(value, depth = 0, seen = new Set()) {
  if (depth > 8) throw error('Metadane są zbyt głębokie.');
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw error('Aliasy/cykle YAML nie są dozwolone.');
  seen.add(value);
  if (Object.keys(value).length > 100) throw error('Metadane są zbyt rozbudowane.');
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw error('Niedozwolony klucz metadanych.');
    boundedData(item, depth + 1, seen);
  }
}
function parseSkill(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 65536) throw error('SKILL.md przekracza limit 64 KiB.');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match || match[1].length > 16000) throw error('SKILL.md wymaga ograniczonego nagłówka YAML.');
  let metadata;
  try { metadata = yaml.load(match[1], { schema: yaml.FAILSAFE_SCHEMA, json: false }); } catch { throw error('Niepoprawny lub niedozwolony YAML.'); }
  boundedData(metadata);
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw error('Metadane muszą być obiektem.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name || '') || metadata.name.length > 64) throw error('Nazwa umiejętności musi mieć 1–64 znaków: małe litery, cyfry i łączniki.');
  if (typeof metadata.description !== 'string' || !metadata.description.trim() || metadata.description.length > 1024) throw error('Wymagany opis do 1024 znaków.');
  if (!match[2].trim()) throw error('Brak instrukcji umiejętności.');
  const jarvis = metadata.metadata?.jarvis || {};
  const permissions = jarvis.permissions === undefined ? [] : jarvis.permissions;
  if (!Array.isArray(permissions) || permissions.length > 20 || permissions.some(p => typeof p !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(p))) throw error('Niepoprawne żądania uprawnień.');
  const platforms = jarvis.platforms === undefined ? [] : jarvis.platforms;
  if (!Array.isArray(platforms) || platforms.some(p => !['linux', 'darwin', 'win32'].includes(p))) throw error('Niepoprawne platformy.');
  return { metadata, instructions: match[2].trim(), permissions, platforms, jarvis };
}
function packageHash(files) {
  return digest(JSON.stringify(Object.keys(files).sort().map(name => ({ path: name, sha256: digest(files[name]), size: files[name].length }))));
}
function runGit(args, { cwd, signal, timeout = 60000, binary = false, allowNetwork = true } = {}) {
  abort(signal);
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', ...(!allowNetwork ? ['-c', 'protocol.https.allow=never', '-c', 'protocol.http.allow=never', '-c', 'protocol.ssh.allow=never'] : []), ...args], {
      cwd, detached: process.platform !== 'win32', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = []; let size = 0, failure, killTimer;
    const terminate = reason => {
      if (failure) return; failure = reason;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill(); } catch { /* process exited */ }
      killTimer = setTimeout(() => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ } }, 1000);
      killTimer.unref?.();
    };
    const cancelled = () => terminate(error('Pobieranie umiejętności anulowane.', 'ABORTED'));
    signal?.addEventListener('abort', cancelled, { once: true });
    const timer = setTimeout(() => terminate(error('Źródło przekroczyło czas odczytu.', 'SOURCE_TIMEOUT')), timeout);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 4 * MAX_PACKAGE) terminate(error('Katalog źródła przekracza limit.', 'RESOURCE_LIMIT')); else output.push(chunk); });
    child.stderr.on('data', () => {}); // Never echo credentials or arbitrary remote diagnostics.
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', cancelled); };
    child.on('error', e => { cleanup(); reject(error(e.code === 'ENOENT' ? 'Brak programu Git potrzebnego do katalogów umiejętności.' : 'Nie można uruchomić bezpiecznego odczytu Git.', 'MISSING_CONFIGURATION')); });
    child.on('close', code => { cleanup(); if (failure) reject(failure); else if (code !== 0) reject(error('Źródło Git jest niedostępne lub odmówiło dostępu.', 'SOURCE_UNAVAILABLE')); else resolve(binary ? Buffer.concat(output) : Buffer.concat(output).toString('utf8')); });
  });
}
// Node has no portable openat. Linux /proc/self/fd provides an anchored directory
// descriptor, including every ancestor of the authorized root. Other platforms fail
// closed until an equivalent native implementation exists; final O_NOFOLLOW alone
// would not protect against a replaced parent directory.
async function openDirectory(root) {
  if (process.platform !== 'linux' || !path.isAbsolute(root)) throw error('Bezpieczny odczyt lokalnych pakietów wymaga obecnie Linux.', 'UNSUPPORTED_PLATFORM');
  let handle = await fs.open('/', flags.O_RDONLY | flags.O_DIRECTORY | flags.O_NOFOLLOW);
  try {
    for (const part of root.split('/').filter(Boolean)) {
      if (part === '.' || part === '..') throw error('Niepoprawny katalog.');
      const next = await fs.open(`/proc/self/fd/${handle.fd}/${part}`, flags.O_RDONLY | flags.O_DIRECTORY | flags.O_NOFOLLOW);
      await handle.close(); handle = next;
    }
    return handle;
  } catch (e) { await handle.close(); throw e; }
}
function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function requireIdentity(actual, expected) {
  if (!expected || !sameIdentity(actual, expected)) throw error('Katalog lub zasób zmienił tożsamość podczas odczytu.', 'UNSAFE_PATH');
}
async function readLocal(root, relative, identities) {
  safePath(relative);
  let parent = await openDirectory(root), file;
  try {
    requireIdentity(await parent.stat(), identities.get(''));
    const parts = relative.split('/');
    let prefix = '';
    for (const part of parts.slice(0, -1)) {
      const next = await fs.open(`/proc/self/fd/${parent.fd}/${part}`, flags.O_RDONLY | flags.O_DIRECTORY | flags.O_NOFOLLOW);
      await parent.close(); parent = next; prefix = prefix ? `${prefix}/${part}` : part;
      requireIdentity(await parent.stat(), identities.get(prefix));
    }
    file = await fs.open(`/proc/self/fd/${parent.fd}/${parts.at(-1)}`, flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK);
    const before = await file.stat();
    requireIdentity(before, identities.get(relative));
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE) throw error('Specjalny, dowiązany lub zbyt duży zasób.', 'UNSAFE_PATH');
    const bytes = Buffer.alloc(MAX_FILE + 1); let length = 0;
    while (length < bytes.length) { const { bytesRead } = await file.read(bytes, length, bytes.length - length, null); if (!bytesRead) break; length += bytesRead; }
    const after = await file.stat();
    if (length > MAX_FILE || length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.nlink !== 1) throw error('Zasób zmienił się podczas ograniczonego odczytu.', 'HASH_MISMATCH');
    return bytes.subarray(0, length);
  } finally { await file?.close(); await parent.close(); }
}
async function walkLocal(root, strict = false) {
  const result = [], identities = new Map(), handles = []; let visited = 0;
  const close = async () => { await Promise.all(handles.splice(0).map(handle => handle.close())); };
  async function walk(handle, prefix, depth) {
    if (depth > 8) throw error('Katalog umiejętności przekracza głębokość 8.');
    for (const entry of await fs.readdir(`/proc/self/fd/${handle.fd}`, { withFileTypes: true })) {
      if (++visited > 5000) throw error('Katalog zawiera zbyt wiele zasobów.', 'RESOURCE_LIMIT');
      if (!strict && (entry.name.startsWith('.') || entry.name === 'node_modules')) continue;
      const name = prefix ? `${prefix}/${entry.name}` : entry.name; safePath(name);
      const anchored = `/proc/self/fd/${handle.fd}/${entry.name}`, stat = await fs.lstat(anchored);
      if (stat.isSymbolicLink()) throw error('Symlink w katalogu umiejętności.', 'UNSAFE_PATH');
      if (stat.isDirectory()) {
        if (handles.length >= 256) throw error('Katalog przekracza limit 255 podkatalogów.', 'RESOURCE_LIMIT');
        const child = await fs.open(anchored, flags.O_RDONLY | flags.O_DIRECTORY | flags.O_NOFOLLOW);
        handles.push(child); requireIdentity(await child.stat(), stat); identities.set(name, stat); await walk(child, name, depth + 1);
      } else if (stat.isFile() && stat.nlink === 1) { identities.set(name, stat); result.push(name); }
      else throw error('Specjalny plik lub twarde dowiązanie w katalogu umiejętności.', 'UNSAFE_PATH');
      if (strict && result.length > MAX_FILES) throw error('Pakiet przekracza limit 128 plików.', 'RESOURCE_LIMIT');
    }
  }
  const handle = await openDirectory(root);
  handles.push(handle);
  try { identities.set('', await handle.stat()); await walk(handle, '', 0); return { names: result, identities, close }; } catch (e) { await close(); throw e; }
}

function createSkillManager(options) {
  if (!path.isAbsolute(options?.directory || '')) throw error('Wymagany bezwzględny katalog menedżera.');
  const directory = options.directory, storeFile = path.join(directory, 'skills-lock.v1.json');
  const now = options.now || Date.now, sandbox = options.sandbox;
  const sources = options.sources || SOURCES;
  if (sources.some(repo => !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo))) throw error('Niepoprawne repozytorium źródłowe.');
  let queue = Promise.resolve();
  const active = new Map();
  function cancelRecord(id) { for (const controller of active.get(id) || []) controller.abort(); }
  async function isolated(record, method, args, context) {
    const controller = new AbortController(); const cancel = () => controller.abort();
    if (context.signal?.aborted) controller.abort(); else context.signal?.addEventListener('abort', cancel, { once: true });
    const controllers = active.get(record.id) || new Set(); controllers.add(controller); active.set(record.id, controllers);
    try { return await sandbox[method]({ ...args, signal: controller.signal }); }
    finally { context.signal?.removeEventListener('abort', cancel); controllers.delete(controller); if (!controllers.size) active.delete(record.id); }
  }
  const serialize = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
  const fresh = () => ({ schemaVersion: 1, revision: 0, skills: [], candidates: [], policies: [], tasks: {}, journal: [] });
  async function transaction(fn, write = true) {
    return serialize(async () => {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const lock = path.join(directory, '.skills-lock'); let handle;
      async function acquire() {
        try { handle = await fs.open(lock, 'wx', 0o600); await handle.writeFile(String(process.pid)); return true; }
        catch (e) { if (e.code !== 'EEXIST') throw e; return false; }
      }
      if (!await acquire()) {
        let previous = ''; try { previous = await fs.readFile(lock, 'utf8'); } catch { /* fail closed */ }
        const pid = Number(previous); let dead = false;
        if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (e) { dead = e.code === 'ESRCH'; } }
        if (dead) {
          const recovery = lock + '.recovery'; let owned = false;
          try {
            await fs.mkdir(recovery); owned = true;
            if (await fs.readFile(lock, 'utf8') === previous) await fs.unlink(lock);
          } catch (e) { if (!['EEXIST', 'ENOENT'].includes(e.code)) throw e; }
          finally { if (owned) await fs.rmdir(recovery); }
        }
        if (!await acquire()) throw error('Magazyn umiejętności jest zajęty; nie uruchomiono równoległej zmiany.', 'STORE_LOCKED');
      }
      try {
        let state; try { state = JSON.parse(await fs.readFile(storeFile, 'utf8')); } catch (e) { if (e.code === 'ENOENT') state = fresh(); else throw error('Uszkodzony magazyn umiejętności.', 'STORE_CORRUPT'); }
        if (state.schemaVersion !== 1 || !['skills', 'candidates', 'policies', 'journal'].every(k => Array.isArray(state[k])) || !state.tasks) throw error('Nieobsługiwana wersja magazynu umiejętności.', 'STORE_CORRUPT');
        const value = await fn(state);
        if (write) {
          state.revision++;
          const temp = storeFile + '.' + nodeCrypto.randomUUID() + '.tmp';
          const file = await fs.open(temp, 'wx', 0o600);
          try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
          await fs.rename(temp, storeFile);
        }
        return clone(value ?? null);
      } finally { await handle.close(); await fs.unlink(lock); }
    });
  }
  function log(state, action, id, detail) { state.journal.push({ at: now(), action, id, detail }); if (state.journal.length > 2000) state.journal.splice(0, state.journal.length - 2000); }
  function sourceKey(source) { return source.kind === 'authored' ? 'jarvis:self' : source.repo || `local:${source.localRoot}`; }
  function allowed(state, record) {
    return state.policies.some(p => p.enabled && p.source === sourceKey(record.source) && p.codeKinds.includes(record.codeKind) && record.permissions.every(value => p.permissions.includes(value)) && p.licenses.includes(record.license));
  }
  async function gitSource(repo, signal, pinnedCommit, allowNetwork = true) {
    if (!sources.includes(repo)) throw error('Źródło nie należy do skonfigurowanego katalogu.', 'SOURCE_NOT_ALLOWED');
    const remote = `https://github.com/${repo}.git`;
    if (!allowNetwork && !pinnedCommit) throw error('Internet wyłączony; dostępny wyłącznie zapisany katalog.', 'NETWORK_DISABLED');
    const head = pinnedCommit ? '' : await runGit(['ls-remote', remote, 'HEAD'], { signal });
    const commit = pinnedCommit || head.match(/^([a-f0-9]{40})\s+HEAD/m)?.[1]; if (!/^[a-f0-9]{40}$/.test(commit || '')) throw error('Źródło nie podało przypiętego commitu.', 'SOURCE_UNAVAILABLE');
    const cache = path.join(directory, 'catalogs', repo.replace('/', '--') + '-' + commit);
    await fs.mkdir(path.dirname(cache), { recursive: true, mode: 0o700 });
    try { await fs.access(path.join(cache, 'HEAD')); } catch {
      if (!allowNetwork) throw error('Brak przypiętego źródła w lokalnym cache; internet wyłączony.', 'NETWORK_DISABLED');
      const temporary = cache + '.tmp-' + nodeCrypto.randomUUID();
      try {
        await runGit(['clone', '--bare', '--depth=1', '--filter=blob:none', '--no-tags', remote, temporary], { signal, timeout: 90000 });
        const actual = (await runGit(['rev-parse', 'HEAD'], { cwd: temporary, signal })).trim();
        if (actual !== commit) {
          if (!pinnedCommit) throw error('Źródło zmieniło commit podczas pobierania; ponów inspekcję.', 'SOURCE_CHANGED');
          await runGit(['fetch', '--depth=1', 'origin', commit], { cwd: temporary, signal });
          if ((await runGit(['rev-parse', 'FETCH_HEAD'], { cwd: temporary, signal })).trim() !== commit) throw error('Nie pobrano przypiętego commitu.', 'SOURCE_CHANGED');
        }
        await fs.rename(temporary, cache);
      } catch (e) { await fs.rm(temporary, { recursive: true, force: true }); throw e; }
    }
    const entries = (await runGit(['ls-tree', '-rz', '--full-tree', commit], { cwd: cache, signal, allowNetwork })).split('\0').filter(Boolean).map(line => {
      const match = line.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/); if (!match) throw error('Niepoprawne drzewo Git.');
      return { mode: match[1], kind: match[2], object: match[3], name: match[4] };
    });
    if (entries.length > 20000) throw error('Katalog źródłowy przekracza limit.', 'RESOURCE_LIMIT');
    const read = async name => {
      safePath(name); const entry = entries.find(item => item.name === name);
      if (!entry || entry.kind !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw error('Brak zasobu lub niedozwolony typ pliku.');
      const size = Number((await runGit(['cat-file', '-s', entry.object], { cwd: cache, signal, allowNetwork })).trim());
      if (!Number.isFinite(size) || size > MAX_FILE) throw error('Zasób źródła jest zbyt duży.');
      return runGit(['show', `${commit}:${name}`], { cwd: cache, signal, binary: true, allowNetwork });
    };
    return { repo, commit, entries, read };
  }
  async function candidateFrom(source, folder, read, paths) {
    const skillPath = folder ? `${folder}/SKILL.md` : 'SKILL.md';
    const content = (await read(skillPath)).toString('utf8'); const parsed = parseSkill(content);
    let license = typeof parsed.metadata.license === 'string' ? parsed.metadata.license.trim().slice(0, 1000) : '';
    let licenseFile;
    const ancestors = []; let ancestor = folder;
    while (ancestor) { ancestors.push(ancestor); ancestor = path.posix.dirname(ancestor); if (ancestor === '.') break; }
    const licenseCandidates = [...ancestors, ''].flatMap(dir => ['LICENSE.txt', 'LICENSE', 'LICENSE.md'].map(name => dir ? `${dir}/${name}` : name));
    for (const candidate of licenseCandidates) {
      if (paths.includes(candidate)) {
        const data = await read(candidate); licenseFile = { path: candidate, hash: digest(data) };
        if (!license) license = /MIT License/i.test(data.toString()) ? 'MIT' : /Apache License/i.test(data.toString()) ? 'Apache-2.0' : 'CUSTOM_REVIEW_REQUIRED';
        break;
      }
    }
    const publisher = source.repo?.split('/')[0] || 'local';
    const version = String(parsed.metadata.metadata?.version || source.commit?.slice(0, 12) || digest(content).slice(0, 12));
    if (!/^[a-zA-Z0-9._+-]{1,80}$/.test(version)) throw error('Niepoprawna wersja.');
    const candidateId = digest(JSON.stringify([source, folder, digest(content)])).slice(0, 32);
    return { candidateId, publisher, name: parsed.metadata.name, version, description: parsed.metadata.description, source: { ...source, path: folder }, sourceNotice: source.repo === 'openai/skills' ? 'Deprecated upstream: maintained successor is separately configured openai/plugins.' : null, skillHash: digest(content), license: license || 'MISSING_LICENSE', licenseFile: licenseFile || null, permissions: parsed.permissions, dependencies: parsed.jarvis.dependencies || [], declaredAllowedTools: parsed.metadata['allowed-tools'] || null, compatibility: parsed.metadata.compatibility || null, platforms: parsed.platforms, state: 'DISCOVERED', discoveredAt: now() };
  }
  async function search(query, refresh, context) {
    if (typeof query !== 'string' || query.length > 300) throw error('Zapytanie ma limit 300 znaków.');
    const cached = await transaction(s => s.candidates, false);
    const failures = [];
    if ((refresh || !cached.length) && context.allowNetwork !== false) {
      for (const repo of sources) {
        abort(context.signal);
        try {
          const source = await gitSource(repo, context.signal), found = [];
          const skills = source.entries.filter(e => /(^|\/)SKILL\.md$/.test(e.name) && e.name.split('/').length <= 7).slice(0, 100);
          for (const entry of skills) {
            abort(context.signal);
            try { found.push(await candidateFrom({ repo, commit: source.commit }, path.posix.dirname(entry.name) === '.' ? '' : path.posix.dirname(entry.name), source.read, source.entries.map(e => e.name))); }
            catch (e) { failures.push({ source: repo, path: entry.name, code: e.code || 'INVALID_SKILL', message: e.message }); }
          }
          await transaction(state => { state.candidates = [...state.candidates.filter(c => c.source.repo !== repo), ...found].slice(-500); });
        } catch (e) { abort(context.signal); failures.push({ source: repo, code: e.code || 'SOURCE_UNAVAILABLE', message: e.message }); }
      }
    }
    const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const all = await transaction(s => s.candidates, false);
    const scored = all.map(c => ({ ...c, relevance: words.reduce((score, word) => score + (`${c.name} ${c.description}`.toLocaleLowerCase().includes(word) ? 1 : 0), 0) })).filter(c => !words.length || c.relevance > 0).sort((a, b) => b.relevance - a.relevance || a.candidateId.localeCompare(b.candidateId));
    return { candidates: scored.slice(0, 20), failures, queryTransmitted: false, networkAllowed: context.allowNetwork !== false, scope: sources };
  }
  async function readCandidate(candidate, signal, allowNetwork = true) {
    let read, names, source, snapshot;
    try {
    if (candidate.source.repo) {
      source = await gitSource(candidate.source.repo, signal, candidate.source.commit, allowNetwork);
      names = source.entries.map(e => e.name); read = source.read;
    } else {
      snapshot = await walkLocal(candidate.source.localRoot); names = snapshot.names; read = name => readLocal(candidate.source.localRoot, name, snapshot.identities);
    }
    const folder = candidate.source.path, prefix = folder ? folder + '/' : '';
    const selected = names.filter(name => name.startsWith(prefix)).filter(name => !name.slice(prefix.length).startsWith('.'));
    if (selected.length > MAX_FILES) throw error('Pakiet przekracza limit 128 plików.', 'RESOURCE_LIMIT');
    const files = Object.create(null); let size = 0;
    for (const name of selected) { abort(signal); const relative = safePath(name.slice(prefix.length)); const data = await read(name); size += data.length; if (size > MAX_PACKAGE) throw error('Pakiet przekracza limit 2 MiB.', 'RESOURCE_LIMIT'); files[relative] = data; }
    if (!Object.hasOwn(files, 'SKILL.md') || digest(files['SKILL.md']) !== candidate.skillHash) throw error('SKILL.md zmienił hash od inspekcji.', 'HASH_MISMATCH');
    if (candidate.licenseFile && !selected.includes(candidate.licenseFile.path)) {
      const license = await read(candidate.licenseFile.path);
      if (digest(license) !== candidate.licenseFile.hash) throw error('Licencja źródła zmieniła hash.', 'HASH_MISMATCH');
      files['LICENSE.repository'] = license;
    }
    if (Object.keys(files).length > MAX_FILES || Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > MAX_PACKAGE) throw error('Pakiet z licencją przekracza limit 128 plików / 2 MiB.', 'RESOURCE_LIMIT');
    return files;
    } finally { await snapshot?.close(); }
  }
  async function checkFiles(record) {
    const packageDir = path.join(directory, 'packages', record.hash);
    const snapshot = await walkLocal(packageDir, true), { names, identities } = snapshot;
    try {
    const files = Object.create(null); let size = 0;
    for (const name of names) { const content = await readLocal(packageDir, name, identities); size += content.length; if (size > MAX_PACKAGE) throw error('Pakiet przekracza limit.', 'HASH_MISMATCH'); files[name] = content; }
    if (packageHash(files) !== record.hash) throw error('Zawartość umiejętności zmieniła hash.', 'HASH_MISMATCH');
    return { directory: packageDir, files, parsed: parseSkill(files['SKILL.md'].toString()) };
    } finally { await snapshot.close(); }
  }
  function requiredResources(parsed, files) {
    const required = parsed.jarvis.requiredResources || [];
    if (!Array.isArray(required) || required.length > MAX_FILES) throw error('Niepoprawna lista wymaganych zasobów.');
    const references = [...required];
    for (const match of parsed.instructions.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^(?:https?:|mailto:|#)/i.test(match[1])) continue;
      let name; try { name = decodeURIComponent(match[1].split('#')[0]); } catch { throw error('Niepoprawna ścieżka odnośnika.'); }
      if (name.startsWith('./')) name = name.slice(2);
      references.push(name);
    }
    for (const name of references) { safePath(name); if (!Object.hasOwn(files, name)) throw error(`Brak wymaganego zasobu: ${name}`, 'MISSING_RESOURCE'); }
    const dependencies = parsed.jarvis.dependencies || [];
    if (!Array.isArray(dependencies) || dependencies.length > 40) throw error('Zależności wymagają listy przypiętych zasobów {path, sha256}.', 'MISSING_CONFIGURATION');
    for (const dependency of dependencies) {
      if (!dependency || typeof dependency !== 'object' || !/^[a-f0-9]{64}$/.test(dependency.sha256 || '')) throw error('Nieprzypięta zależność: wymagany path i sha256; automatyczne instalatory są wyłączone.', 'MISSING_CONFIGURATION');
      safePath(dependency.path);
      if (!Object.hasOwn(files, dependency.path)) throw error(`Brak zależności: ${dependency.path}`, 'MISSING_CONFIGURATION');
      if (digest(files[dependency.path]) !== dependency.sha256) throw error(`Zależność zmieniła hash: ${dependency.path}`, 'HASH_MISMATCH');
    }
  }
  async function checkedRecord(id) {
    const record = await transaction(s => s.skills.find(item => item.id === id), false);
    if (!record) throw error('Nie znaleziono zainstalowanej wersji.');
    try { return { record, ...(await checkFiles(record)) }; }
    catch (e) { await transaction(s => { const r = s.skills.find(item => item.id === id); if (r && r.state !== 'REVOKED') { r.state = 'BROKEN'; r.lastError = e.message; log(s, 'BROKEN', id, e.code); } }); throw e; }
  }
  async function command(request, context = {}) {
    if (!request || typeof request.action !== 'string') throw error('Brak działania umiejętności.');
    abort(context.signal);
    const action = request.action;
    if (action === 'list') return transaction(s => ({ skills: s.skills, candidates: s.candidates, policies: s.policies, sources: [...sources, 'jarvis:self'], taskPins: s.tasks }), false);
    if (action === 'search') return search(request.query || '', request.refresh === true, context);
    if (action === 'policy') {
      if (context.trustedUserAction !== true) throw error('Politykę może zatwierdzić wyłącznie właściciel.', 'APPROVAL_REQUIRED');
      const source = request.source;
      if (!sources.includes(source) && source !== 'jarvis:self' && !(typeof source === 'string' && source.startsWith('local:') && path.isAbsolute(source.slice(6)))) throw error('Nieobsługiwane źródło polityki.');
      if (!Array.isArray(request.codeKinds) || !request.codeKinds.length || request.codeKinds.some(k => !['instructions', 'executable'].includes(k))) throw error('Wymagany jawny rodzaj kodu.');
      if (!Array.isArray(request.permissions) || request.permissions.some(p => typeof p !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(p))) throw error('Wymagane konkretne uprawnienia.');
      const licenses = request.licenses || ['MIT', 'Apache-2.0'];
      if (!Array.isArray(licenses) || !licenses.length || licenses.some(l => typeof l !== 'string' || !l || l.length > 1000 || l === 'MISSING_LICENSE')) throw error('Wymagane zatwierdzone warunki licencji.');
      const normalized = source.startsWith('local:') ? 'local:' + await fs.realpath(source.slice(6)) : source;
      return transaction(s => { const p = { source: normalized, codeKinds: request.codeKinds, permissions: request.permissions, licenses, enabled: request.enabled !== false, approvedAt: now() }; s.policies = [...s.policies.filter(p => p.source !== normalized), p]; for (const r of s.skills) if (sourceKey(r.source) === normalized && !allowed(s, r)) cancelRecord(r.id); log(s, 'POLICY', normalized, p.enabled); return p; });
    }
    if (action === 'scan') {
      const localRoot = await fs.realpath(request.path || '');
      const policy = await transaction(s => s.policies.find(p => p.source === `local:${localRoot}` && p.enabled), false);
      if (!policy) throw error('Katalog projektu nie ma jawnej zgody na odczyt.', 'APPROVAL_REQUIRED');
      const snapshot = await walkLocal(localRoot), { names, identities } = snapshot, found = [];
      try { for (const name of names.filter(n => /(^|\/)SKILL\.md$/.test(n)).slice(0, 100)) found.push(await candidateFrom({ localRoot }, path.posix.dirname(name) === '.' ? '' : path.posix.dirname(name), n => readLocal(localRoot, n, identities), names)); }
      finally { await snapshot.close(); }
      await transaction(s => { s.candidates = [...s.candidates.filter(c => c.source.localRoot !== localRoot), ...found].slice(-500); });
      return { candidates: found };
    }
    if (action === 'author') {
      if (!request.files || typeof request.files !== 'object' || Array.isArray(request.files)) throw error('Wymagana mapa plików autora.');
      const names = Object.keys(request.files); if (!names.length || names.length > MAX_FILES) throw error('Limit 128 plików własnej umiejętności.');
      const files = Object.create(null); let size = 0;
      for (const name of names) {
        safePath(name);
        if (name.split('/').some(p => p.startsWith('.')) || typeof request.files[name] !== 'string') throw error('Autor przyjmuje jawne tekstowe zasoby bez plików ukrytych.');
        const data = Buffer.from(request.files[name]); size += data.length;
        if (data.length > MAX_FILE || size > MAX_PACKAGE) throw error('Przekroczono limit własnej umiejętności.', 'RESOURCE_LIMIT');
        files[name] = data;
      }
      if (!Object.hasOwn(files, 'SKILL.md')) throw error('Brak SKILL.md.');
      const parsed = parseSkill(files['SKILL.md'].toString()), hash = packageHash(files);
      const license = typeof parsed.metadata.license === 'string' ? parsed.metadata.license.trim() : 'MISSING_LICENSE';
      const version = parsed.metadata.metadata?.version || hash.slice(0, 12);
      if (!/^[a-zA-Z0-9._+-]{1,80}$/.test(version)) throw error('Niepoprawna wersja autora.');
      const id = `jarvis-self/${parsed.metadata.name}@${version}`;
      const prior = await transaction(s => s.skills.find(r => r.id === id), false);
      if (prior) { if (prior.hash !== hash) throw error('Wersja własnej umiejętności ma już inną zawartość.', 'VERSION_CONFLICT'); return prior; }
      const final = path.join(directory, 'packages', hash), temporary = final + '.tmp-' + nodeCrypto.randomUUID();
      await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
      try {
        for (const [name, content] of Object.entries(files)) { const destination = path.join(temporary, name); await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 }); await fs.writeFile(destination, content, { mode: 0o600, flag: 'wx' }); }
        abort(context.signal); await fs.rename(temporary, final).catch(async e => { if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e; await fs.rm(temporary, { recursive: true }); });
      } catch (e) { await fs.rm(temporary, { recursive: true, force: true }); throw e; }
      const resources = names.sort().map(name => ({ path: name, size: files[name].length, hash: digest(files[name]) }));
      const record = { id, publisher: 'jarvis-self', name: parsed.metadata.name, version, description: parsed.metadata.description,
        source: { kind: 'authored', path: '' }, hash, skillHash: digest(files['SKILL.md']), license, permissions: parsed.permissions, platforms: parsed.platforms, dependencies: parsed.jarvis.dependencies || [],
        codeKind: resources.some(r => r.path.startsWith('scripts/') || /\.(?:cjs|mjs|js|py|sh|exe|wasm)$/.test(r.path)) ? 'executable' : 'instructions', resources,
        state: 'QUARANTINED', test: null, createdAt: now(), updatedAt: now() };
      await checkFiles(record);
      return transaction(s => {
        const existing = s.skills.find(r => r.id === id);
        if (existing) { if (existing.hash !== hash) throw error('Konkurencyjna wersja ma inną zawartość.', 'VERSION_CONFLICT'); return existing; }
        if (s.skills.length >= 500) throw error('Limit 500 wersji.', 'RESOURCE_LIMIT'); s.skills.push(record); log(s, 'AUTHORED', id, hash); return record;
      });
    }
    if (action === 'inspect' || action === 'stage' || action === 'update') {
      const candidate = await transaction(s => s.candidates.find(c => c.candidateId === request.candidateId), false);
      if (!candidate) throw error('Najpierw wyszukaj lub odczytaj kandydata.');
      const files = await readCandidate(candidate, context.signal, context.allowNetwork !== false), parsed = parseSkill(files['SKILL.md'].toString());
      const resources = Object.keys(files).sort().map(name => ({ path: name, size: files[name].length, hash: digest(files[name]) }));
      const hash = packageHash(files), id = `${candidate.publisher}/${candidate.name}@${candidate.version}`;
      if (action === 'inspect') {
        await transaction(s => { const c = s.candidates.find(c => c.candidateId === candidate.candidateId); c.inspectedHash = hash; c.inspectedAt = now(); });
        const licensePath = resources.find(r => /(^|\/)LICENSE(?:\.[\w-]+)?$/i.test(r.path))?.path;
        return { candidate, instructions: parsed.instructions, resources, hash, licenseText: licensePath ? files[licensePath].toString('utf8').slice(0, 65536) : null, untrusted: true };
      }
      if (candidate.inspectedHash && candidate.inspectedHash !== hash) throw error('Zawartość zmieniła się po inspekcji.', 'HASH_MISMATCH');
      if (action === 'update') {
        const existing = await transaction(s => s.skills.find(c => c.id === request.id), false);
        if (!existing || existing.publisher !== candidate.publisher || existing.name !== candidate.name || sourceKey(existing.source) !== sourceKey(candidate.source)) throw error('Aktualizacja musi pochodzić z tego samego źródła i tożsamości.');
      }
      const prior = await transaction(s => s.skills.find(r => r.id === id), false);
      if (prior) { if (prior.hash !== hash) throw error('Kolizja identyfikatora: wersja ma inną zawartość.', 'VERSION_CONFLICT'); return prior; }
      const packages = path.join(directory, 'packages'), final = path.join(packages, hash), temporary = final + '.tmp-' + nodeCrypto.randomUUID();
      await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
      try {
        for (const [name, content] of Object.entries(files)) { const destination = path.join(temporary, safePath(name)); await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 }); await fs.writeFile(destination, content, { flag: 'wx', mode: 0o600 }); }
        abort(context.signal); await fs.rename(temporary, final).catch(async e => { if (e.code !== 'EEXIST' && e.code !== 'ENOTEMPTY') throw e; await fs.rm(temporary, { recursive: true }); });
      } catch (e) { await fs.rm(temporary, { recursive: true, force: true }); throw e; }
      const codeKind = resources.some(r => r.path.startsWith('scripts/') || /\.(?:cjs|mjs|js|py|sh|exe|wasm)$/.test(r.path)) ? 'executable' : 'instructions';
      const record = { ...candidate, id, hash, codeKind, resources, state: 'QUARANTINED', test: null, createdAt: now(), updatedAt: now() };
      await checkFiles(record);
      return transaction(s => {
        const existing = s.skills.find(r => r.id === id);
        if (existing) { if (existing.hash !== hash) throw error('Konkurencyjna wersja ma inną zawartość.', 'VERSION_CONFLICT'); return existing; }
        if (s.skills.length >= 500) throw error('Limit 500 wersji umiejętności.', 'RESOURCE_LIMIT'); s.skills.push(record); log(s, 'STAGED', id, hash); return record;
      });
    }
    if (action === 'assert_task') {
      const taskId = context.taskId || request.taskId;
      const pins = await transaction(s => s.tasks[taskId] || [], false);
      for (const pin of pins) {
        const { record } = await checkedRecord(pin.id);
        if (record.hash !== pin.hash || ['REVOKED', 'BROKEN'].includes(record.state)) throw error('Przypięta umiejętność została odwołana lub zmieniona.', 'SKILL_REVOKED');
        if (!await transaction(s => allowed(s, record), false)) throw error('Cofnięto zakresową zgodę umiejętności.', 'APPROVAL_REQUIRED');
      }
      return { ok: true, pins };
    }
    if (action === 'release_task') {
      const taskId = context.taskId || request.taskId; return transaction(s => { delete s.tasks[taskId]; return { released: true }; });
    }
    if (['disable', 'revoke', 'remove'].includes(action)) return transaction(s => {
      const r = s.skills.find(x => x.id === request.id); if (!r) throw error('Nie znaleziono wersji.');
      if (action === 'disable' && r.state !== 'REVOKED') r.state = 'DISABLED';
      if (action === 'revoke' || action === 'remove') { r.state = 'REVOKED'; cancelRecord(r.id); }
      if (action === 'remove') r.removedAt = now(); // Tombstone keeps provenance; user source/documents remain untouched.
      r.updatedAt = now(); log(s, action.toUpperCase(), r.id, r.hash); return r;
    });
    const { record, files, parsed, directory: packageDir } = await checkedRecord(request.id);
    if (action === 'resource') { const name = safePath(request.path); if (!Object.hasOwn(files, name)) throw error('Brak wymaganego zasobu.'); if (files[name].length > 65536) throw error('Zasób przekracza limit kontekstu 64 KiB.'); return { id: record.id, path: name, hash: digest(files[name]), content: files[name].toString('utf8'), untrusted: true }; }
    if (action === 'test') {
      if (record.state === 'REVOKED') throw error('Odwołanej wersji nie testuje się ponownie w celu aktywacji.', 'SKILL_REVOKED');
      let result;
      let resourceFailure;
      try { requiredResources(parsed, files); } catch (e) { resourceFailure = e; }
      if (resourceFailure) result = { ok: false, status: resourceFailure.code, reason: resourceFailure.message };
      else if (record.platforms.length && !record.platforms.includes(process.platform)) result = { ok: false, status: 'MISSING_CONFIGURATION', reason: 'Niezgodna platforma.' };
      else if (record.license === 'MISSING_LICENSE') result = { ok: false, status: 'MISSING_CONFIGURATION', reason: 'Brak warunków licencji.' };
      else if (record.codeKind === 'instructions') result = { ok: true, status: 'STATIC_ONLY', evidence: { hash: record.hash, kind: 'metadata and resource integrity; no executable code and no task-success claim' } };
      else {
        const spec = parsed.jarvis.test;
        if (!sandbox || !spec?.entrypoint || typeof spec.expectedOutput !== 'string') result = { ok: false, status: 'MISSING_CONFIGURATION', reason: 'Kod wymaga izolacji OS i jawnego testu z oczekiwanym wyjściem.' };
        else {
          safePath(spec.entrypoint); if (!Object.hasOwn(files, spec.entrypoint)) throw error('Brak zadeklarowanego testu.');
          let input = spec.input || '';
          if (spec.inputJson !== undefined) {
            if (typeof spec.inputJson !== 'string' || Buffer.byteLength(spec.inputJson) > 65536) throw error('inputJson testu ma limit 64 KiB.');
            try { input = JSON.parse(spec.inputJson); } catch { throw error('inputJson wymaga poprawnego JSON.'); }
            boundedData(input);
          }
          const executed = await isolated(record, 'test', { directory: packageDir, entrypoint: spec.entrypoint, input, hash: record.hash }, context);
          result = { ...executed, ok: executed.ok === true && String(executed.output ?? '').trim() === spec.expectedOutput.trim(), expectedOutputMatched: String(executed.output ?? '').trim() === spec.expectedOutput.trim(), oracle: 'package-declared contract; not an independent task oracle', taskCompleted: false };
        }
      }
      abort(context.signal); await checkFiles(record);
      return transaction(s => { const r = s.skills.find(x => x.id === record.id); if (r.state === 'REVOKED') throw error('Odwołano podczas testu.', 'SKILL_REVOKED'); r.test = { ...result, hash: record.hash, at: now() }; r.state = result.ok ? 'VERIFIED' : 'QUARANTINED'; r.updatedAt = now(); log(s, 'TESTED', r.id, { status: result.status, ok: result.ok }); return r; });
    }
    if (action === 'activate' || action === 'rollback') {
      const target = action === 'rollback' ? (await checkedRecord(request.targetId)).record : record;
      if (action === 'rollback' && (target.publisher !== record.publisher || target.name !== record.name || sourceKey(target.source) !== sourceKey(record.source))) throw error('Rollback wymaga tej samej tożsamości źródła.');
      return transaction(s => {
        const r = s.skills.find(x => x.id === target.id);
        if (!r.test?.ok || r.test.hash !== r.hash || ['REVOKED', 'BROKEN'].includes(r.state)) throw error('Aktywacja wymaga sprawdzonej, nieodwołanej zawartości.', 'TEST_REQUIRED');
        if (!allowed(s, r)) throw error('Brak zatwierdzonego źródła, rodzaju kodu, licencji lub zakresu uprawnień.', 'APPROVAL_REQUIRED');
        r.state = 'APPROVED'; log(s, 'APPROVED', r.id, r.hash);
        for (const previous of s.skills) if (previous.id !== r.id && previous.publisher === r.publisher && previous.name === r.name && previous.state === 'ACTIVE') previous.state = 'DISABLED';
        r.state = 'ACTIVE'; r.updatedAt = now(); log(s, action.toUpperCase(), r.id, r.hash); return r;
      });
    }
    if (action === 'pin' || action === 'run') {
      const taskId = context.taskId || request.taskId;
      if (typeof taskId !== 'string' || !/^[a-zA-Z0-9:_.-]{1,120}$/.test(taskId)) throw error('Wykonanie wymaga identyfikatora zadania.');
      await transaction(s => {
        const r = s.skills.find(x => x.id === record.id), pins = s.tasks[taskId] || [];
        const pinned = pins.find(p => p.id === r.id && p.hash === r.hash);
        const otherVersion = pins.find(p => p.id !== r.id && s.skills.some(old => old.id === p.id && old.publisher === r.publisher && old.name === r.name));
        if (otherVersion) throw error(`Zadanie pozostaje przypięte do wersji ${otherVersion.id}; rozpocznij nowe zadanie dla aktualizacji.`, 'PINNED_VERSION');
        if ((!pinned && r.state !== 'ACTIVE') || ['REVOKED', 'BROKEN'].includes(r.state)) throw error('Wersja nie jest aktywna lub została odwołana.', 'SKILL_REVOKED');
        if (!allowed(s, r)) throw error('Brak zakresowej zgody.', 'APPROVAL_REQUIRED');
        if (Object.keys(s.tasks).length >= 2000 && !s.tasks[taskId]) throw error('Limit przypiętych zadań.', 'RESOURCE_LIMIT');
        if (!pinned) { pins.push({ id: r.id, hash: r.hash, pinnedAt: now() }); s.tasks[taskId] = pins; }
        log(s, 'PINNED', r.id, { taskId, hash: r.hash });
      });
      await command({ action: 'assert_task' }, { ...context, taskId });
      if (action === 'pin') return { id: record.id, hash: record.hash, taskId };
      if (record.codeKind === 'instructions') return { kind: 'instructions', id: record.id, hash: record.hash, instructions: parsed.instructions, resources: record.resources, untrusted: true, taskId, taskCompleted: false };
      const entrypoint = parsed.jarvis.entrypoint;
      if (!entrypoint || !sandbox) throw error('Brak zgodnego izolowanego wykonawcy lub entrypoint.', 'MISSING_CONFIGURATION');
      safePath(entrypoint); if (!Object.hasOwn(files, entrypoint)) throw error('Brak zasobu wykonawczego.');
      const result = await isolated(record, 'run', { directory: packageDir, entrypoint, hash: record.hash, input: request.input, taskId }, context);
      await command({ action: 'assert_task' }, { ...context, taskId });
      return { kind: 'execution', id: record.id, hash: record.hash, taskId, ...result };
    }
    throw error('Nieobsługiwane działanie umiejętności.');
  }
  return { command, assertTask: (taskId, context = {}) => command({ action: 'assert_task' }, { ...context, taskId }), stopAll: () => { for (const id of active.keys()) cancelRecord(id); } };
}
module.exports = { createSkillManager, parseSkill, safePath, packageHash, SOURCES };
