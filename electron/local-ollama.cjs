// Kontrolowany start wyłącznie lokalnej Ollamy. Żadnych shelli, pobrań ani zmian ustawień.
const http = require("node:http");
const { spawn } = require("node:child_process");

function isDefaultLocalOllama(raw, port = 11434) {
  try {
    const url = new URL(String(raw || ""));
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.port === String(port) && !url.username && !url.password
      && (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash;
  } catch { return false; }
}

function probeOllama(port) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => { if (!done) { done = true; resolve(result); } };
    const req = http.get({ host: "127.0.0.1", port, path: "/api/tags", timeout: 1000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (part) => { body += part; if (body.length > 1024 * 1024) { res.destroy(); finish("invalid"); } });
      res.on("error", () => finish("invalid"));
      res.on("end", () => {
        try { finish(res.statusCode === 200 && Array.isArray(JSON.parse(body).models) ? "ready" : "invalid"); }
        catch { finish("invalid"); }
      });
    });
    req.on("timeout", () => { req.destroy(); finish("invalid"); });
    req.on("error", (err) => finish(err.code === "ECONNREFUSED" ? "refused" : "invalid"));
  });
}

function createLocalOllamaManager({ port = 11434, start = spawn, timeoutMs = 12000, intervalMs = 250 } = {}) {
  let child = null;
  let pending = null;
  let closed = false;
  const close = () => {
    closed = true;
    if (child && child.exitCode === null && !child.killed) child.kill();
  };
  const ensure = (url) => {
    if (!isDefaultLocalOllama(url, port)) return Promise.resolve({ ok: false, skipped: true, error: "Automatyczny start obsługuje tylko lokalną Ollamę na porcie domyślnym." });
    if (closed) return Promise.resolve({ ok: false, error: "Aplikacja jest zamykana." });
    if (pending) return pending;
    pending = (async () => {
      const initial = await probeOllama(port);
      if (closed) return { ok: false, error: "Aplikacja jest zamykana." };
      if (initial === "ready") return { ok: true, started: false };
      if (initial !== "refused") return { ok: false, error: "Port Ollamy odpowiada nieprawidłowo lub jest niedostępny. Nie uruchomiono drugiego serwera." };
      let spawnError = "";
      let exited = false;
      try {
        child = start("ollama", ["serve"], { shell: false, windowsHide: true, stdio: "ignore", env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}` } });
      } catch (error) { return { ok: false, error: `Nie udało się uruchomić Ollamy: ${error.message}` }; }
      const owned = child;
      owned.once("error", (error) => { spawnError = error.code === "ENOENT" ? "Nie znaleziono programu ollama. Zainstaluj go lub dodaj do PATH." : `Nie udało się uruchomić Ollamy: ${error.message}`; });
      owned.once("exit", () => { exited = true; if (child === owned) child = null; });
      const deadline = Date.now() + timeoutMs;
      while (!closed && Date.now() < deadline) {
        if (spawnError) return { ok: false, error: spawnError };
        if (exited || owned.exitCode !== null) return { ok: false, error: `Ollama zakończyła pracę (kod ${owned.exitCode ?? "brak"}).` };
        const ready = await probeOllama(port);
        if (closed) break;
        if (ready === "ready" && !exited && owned.exitCode === null) return { ok: true, started: true };
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      if (owned.exitCode === null && !owned.killed) owned.kill();
      return { ok: false, error: closed ? "Aplikacja jest zamykana." : "Ollama nie potwierdziła gotowości w wyznaczonym czasie." };
    })().finally(() => { pending = null; });
    return pending;
  };
  return { ensure, close };
}
// Production entry: read the configured endpoint, never infer its port.
function configuredLocalPort(raw) {
  try {
    const url = new URL(String(raw || ""));
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || !isDefaultLocalOllama(raw, port)) return null;
    return port;
  } catch { return null; }
}
function createConfiguredLocalOllamaManager(options = {}) {
  let manager = null;
  let currentPort = null;
  let closed = false;
  return {
    ensure(url) {
      const port = configuredLocalPort(url);
      if (closed) return Promise.resolve({ ok: false, error: "Aplikacja jest zamykana." });
      if (port === null) return Promise.resolve({ ok: false, skipped: true, error: "Automatyczny start wymaga jawnego lokalnego adresu HTTP i portu 1024–65535, bez ścieżki i danych logowania." });
      if (port !== currentPort) {
        manager?.close(); // Only a process owned by this app can be stopped here.
        manager = createLocalOllamaManager({ ...options, port });
        currentPort = port;
      }
      return manager.ensure(url);
    },
    close() { closed = true; manager?.close(); },
  };
}
module.exports = { isDefaultLocalOllama, probeOllama, createLocalOllamaManager, configuredLocalPort, createConfiguredLocalOllamaManager };
