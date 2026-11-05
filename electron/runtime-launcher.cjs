const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, execFile } = require("child_process");
const { readRuntimeConnection } = require("./runtime-connection.cjs");

// Only the discovery helper can supply the endpoint and token. They never enter a log or IPC result.
function checkRuntimeHealth(connection) {
  if (!connection) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      const request = http.get(`${connection.url}/v1/status`, {
        headers: { Authorization: `Bearer ${connection.token}` }, timeout: 700,
      }, (response) => { response.resume(); finish(response.statusCode === 200); });
      request.on("timeout", () => { request.destroy(); finish(false); });
      request.on("error", () => finish(false));
    } catch { finish(false); }
  });
}

function startUserService() {
  return new Promise((resolve) => {
    try {
      execFile("systemctl", ["--user", "start", "jarvis-runtime.service"],
        { timeout: 3000, windowsHide: true }, (error) => resolve(!error));
    } catch { resolve(false); }
  });
}

/** Independent Linux worker: reuse an authenticated running service; otherwise try systemd,
 * then a detached bundled Node process. None of these paths depends on model readiness. */
function createRuntimeLauncher(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const discovery = options.readConnection || readRuntimeConnection;
  const check = options.checkHealth || checkRuntimeHealth;
  const startService = options.startService || startUserService;
  const spawnProcess = options.spawn || spawn;
  const wait = options.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const script = options.script || (options.isPackaged
    ? path.join(options.resourcesPath || process.resourcesPath, "runtime", "cli.mjs")
    : path.join(__dirname, "..", "server", "runtime", "cli.mjs"));
  const executable = options.execPath || process.execPath;
  const logDir = path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "jarvis");
  let pending = null;
  let lastFailureAt = 0;
  const health = async () => { try { return !!(await check(discovery())); } catch { return false; } };
  const poll = async (attempts) => {
    for (let i = 0; i < attempts; i++) { if (await health()) return true; await wait(200); }
    return false;
  };
  const run = async () => {
    if (platform !== "linux") return { ok: false, error: "Automatyczny serwer jest obecnie dostępny w Linuxie." };
    if (await health()) return { ok: true };
    // The launcher may already be starting it outside Electron; give it time to create discovery.
    if (env.JARVIS_RUNTIME_BOOTSTRAP === "launcher" && await poll(10)) return { ok: true };
    const serviceStarted = await startService();
    if (serviceStarted && await poll(10)) return { ok: true };
    // Even an unsuccessful systemctl call may race a different client starting the same service.
    if (await health()) return { ok: true };
    if (!fs.existsSync(script)) return { ok: false, error: "Brak modułu lokalnego serwera w instalacji." };
    let fd;
    try {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0);
      fd = fs.openSync(path.join(logDir, "runtime.log"), flags, 0o600);
      fs.fchmodSync(fd, 0o600);
      const child = spawnProcess(executable, [script, "start", "--foreground"], {
        env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, detached: true, stdio: ["ignore", fd, fd], windowsHide: true,
      });
      child.once("error", () => {}); // detached worker failure is reported through health, never crashes Electron
      child.unref();
    } catch {
      return { ok: false, error: "Nie udało się uruchomić lokalnego serwera. Sprawdź plik runtime.log." };
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    if (await poll(30)) return { ok: true };
    return { ok: false, error: "Serwer nie odpowiedział. Sprawdź runtime.log lub konflikt portu 3211." };
  };
  return {
    start() {
      if (pending) return pending;
      if (lastFailureAt && Date.now() - lastFailureAt < 3000) return Promise.resolve({ ok: false, error: "Ponów uruchomienie serwera za chwilę." });
      pending = run().catch(() => ({ ok: false, error: "Nie udało się uruchomić lokalnego serwera." })).then((result) => {
        if (!result.ok) lastFailureAt = Date.now(); else lastFailureAt = 0;
        return result;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}
module.exports = { createRuntimeLauncher, checkRuntimeHealth };
