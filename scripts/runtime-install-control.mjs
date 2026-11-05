// Installer-only coordination. Never print credentials or signal an unverified old process.
import { readFile, readlink, readdir, copyFile, mkdir, writeFile, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const [mode, rawDataDir, metadataFile, codeDir, auxiliary] = process.argv.slice(2);
const dataDir = path.resolve(rawDataDir);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function privateFile(file, optional = false) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error(`Nieprywatny plik runtime: ${path.basename(file)}.`);
    return await handle.readFile('utf8');
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  finally { await handle?.close(); }
}
async function identity() {
  const state = JSON.parse(await privateFile(path.join(dataDir, 'state.json'), true) || 'null');
  const lock = JSON.parse(await privateFile(path.join(dataDir, 'runtime.lock'), true) || 'null');
  if (!lock) return { running: false, serverId: state?.serverId };
  if (!Number.isSafeInteger(lock.pid) || lock.pid <= 1) throw new Error('Nieprawidłowy PID blokady runtime.');
  if (!alive(lock.pid)) return { running: false, serverId: state?.serverId };
  const connection = JSON.parse(await privateFile(path.join(dataDir, 'connection.json')));
  const token = (await privateFile(path.join(dataDir, 'token'))).trim();
  const url = new URL(connection.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Nieprawidłowy lokalny adres runtime.');
  if (!/^[a-f0-9]{64}$/.test(token) || token !== connection.token || connection.pid !== lock.pid || !state?.serverId || state.serverId !== connection.serverId) throw new Error('Discovery nie należy do wybranego katalogu danych. Nie zatrzymano procesu.');
  const response = await fetch(`${url.origin}/v1/status`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error('Nie można uwierzytelnić działającego runtime.');
  const status = await response.json();
  if (status.name !== 'JARVIS Runtime' || status.serverId !== state.serverId) throw new Error('Pod adresem działa inny serwer. Nie zatrzymano procesu.');
  const processEnv = Object.fromEntries((await readFile(`/proc/${lock.pid}/environ`, 'utf8')).split('\0')
    .filter((item) => item.includes('=')).map((item) => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]));
  const processData = processEnv.JARVIS_RUNTIME_DATA_DIR || path.join(processEnv.XDG_DATA_HOME || path.join(processEnv.HOME || os.homedir(), '.local/share'), 'jarvis/runtime');
  if (await realpath(processData) !== await realpath(dataDir)) throw new Error('Proces używa innego katalogu danych. Nie zatrzymano go.');
  return { running: true, pid: lock.pid, serverId: state.serverId, version: status.version, capabilities: status.capabilities, url: url.origin, token };
}
async function version(directory) {
  const code = await readFile(path.join(directory, 'server.mjs'), 'utf8');
  const match = code.match(/export\s+const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('Brak wersji serwera w instalowanych plikach.');
  return match[1];
}
async function waitUnlocked() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const lock = JSON.parse(await privateFile(path.join(dataDir, 'runtime.lock'), true) || 'null');
    if (!lock || (Number.isSafeInteger(lock.pid) && lock.pid > 1 && !alive(lock.pid))) return;
    await delay(100);
  }
  throw new Error('Runtime nie zwolnił blokady; nie usunięto danych ani blokady.');
}
async function stopCurrent(expected) {
  const current = await identity();
  if (!current.running) return;
  if (expected.serverId && current.serverId !== expected.serverId) throw new Error('Tożsamość runtime zmieniła się. Nie zatrzymano procesu.');
  if (mode === 'stop' && current.pid !== expected.pid) throw new Error('Proces runtime zmienił się podczas instalacji.');
  const response = await fetch(`${current.url}/v1/stop`, { method: 'POST', headers: { Authorization: `Bearer ${current.token}` }, redirect: 'error', signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Runtime nie przyjął polecenia zatrzymania.');
  await waitUnlocked();
}
async function verify(expected, directory, capabilities) {
  const expectedVersion = await version(directory);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const current = await identity();
      if (current.running && current.version === expectedVersion && (!expected.serverId || current.serverId === expected.serverId)
          && (!capabilities || ['localAnalysis', 'archivedResults', 'requestLookup', 'serverIdentityGuard'].every((key) => current.capabilities?.[key] === true))) return;
    } catch { /* bounded startup wait; no successful report for an old/unrelated process */ }
    await delay(150);
  }
  throw new Error('Nie potwierdzono nowej wersji i możliwości runtime w wybranym katalogu danych.');
}
async function launch(directory, logFile, extraEnv = {}) {
  await mkdir(path.dirname(logFile), { recursive: true, mode: 0o700 });
  const handle = await open(logFile, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid()) throw new Error('Nieprawidłowy plik dziennika runtime.');
    await handle.chmod(0o600);
    const child = spawn(process.execPath, [path.join(directory, 'cli.mjs'), 'start', '--foreground'], {
      env: { ...process.env, ...extraEnv, JARVIS_RUNTIME_DATA_DIR: dataDir }, detached: true,
      stdio: ['ignore', handle.fd, handle.fd],
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { await handle.close(); }
}
try {
  if (mode === 'capture') {
    const current = await identity();
    const metadata = { running: current.running, pid: current.pid, serverId: current.serverId, version: current.version };
    if (current.running) {
      const args = (await readFile(`/proc/${current.pid}/cmdline`, 'utf8')).split('\0');
      const script = args.find((arg) => arg.endsWith('/cli.mjs'));
      const processCode = script && path.dirname(path.resolve(await readlink(`/proc/${current.pid}/cwd`), script));
      const candidates = [processCode, auxiliary];
      for (const entry of await readdir(path.join(path.dirname(auxiliary), 'runtime-releases')).catch(() => [])) candidates.push(path.join(path.dirname(auxiliary), 'runtime-releases', entry));
      let source;
      for (const candidate of candidates.filter(Boolean)) {
        try { if (await version(candidate) === current.version) { await readFile(path.join(candidate, 'cli.mjs')); source = candidate; break; } } catch { /* try another retained generation */ }
      }
      if (!source) throw new Error('Brak odtwarzalnego kodu działającego runtime (np. usunięty katalog starego AppImage). Serwer pozostaje uruchomiony. Zatrzymaj go świadomie poleceniem jarvis-runtime stop, a następnie ponów instalację.');
      await mkdir(codeDir, { recursive: true, mode: 0o700 });
      for (const entry of await readdir(source, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.mjs')) await copyFile(path.join(source, entry.name), path.join(codeDir, entry.name));
      const env = (await readFile(`/proc/${current.pid}/environ`, 'utf8')).split('\0');
      metadata.env = Object.fromEntries(env.map((item) => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]).filter(([key]) => /^JARVIS_RUNTIME_(PORT|MODEL|OLLAMA_URL|AUTO_DISCOVER|AUTO_PROBE|ALLOWED_ORIGINS)$/.test(key)));
    }
    await writeFile(metadataFile, JSON.stringify(metadata), { mode: 0o600 });
    console.log(current.running ? '1' : '0');
  } else {
    const expected = JSON.parse(await readFile(metadataFile, 'utf8'));
    if (mode === 'stop' || mode === 'stop-current') await stopCurrent(expected);
    else if (mode === 'wait') await waitUnlocked();
    else if (mode === 'verify') await verify(expected, codeDir, true);
    else if (mode === 'restore') {
      const current = await identity().catch(() => null);
      if (!current?.running) await launch(codeDir, auxiliary, expected.env);
      await verify(expected, codeDir, false);
    } else if (mode === 'launch') await launch(codeDir, auxiliary);
    else throw new Error('Nieznany tryb kontroli instalacji runtime.');
  }
} catch (error) {
  console.error(`JARVIS Runtime: ${error.message}`);
  process.exitCode = 1;
}
