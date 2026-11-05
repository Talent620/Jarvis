// Controlled lifecycle for the bundled local Site OS. Never starts a tunnel implicitly.
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

function isLocalSiteOs(raw, port = 3210) {
  try {
    const u = new URL(String(raw || ""));
    return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)
      && u.port === String(port) && !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash;
  } catch { return false; }
}

function probeSiteOs(port) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 1000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (part) => { body += part; if (body.length > 65536) { res.destroy(); finish("invalid"); } });
      res.on("error", () => finish("invalid"));
      res.on("end", () => {
        try { const h = JSON.parse(body); finish(res.statusCode === 200 && h.ok === true && h.name === "JARVIS Site OS" && typeof h.version === "string" ? "ready" : "invalid"); }
        catch { finish("invalid"); }
      });
    });
    req.on("timeout", () => { req.destroy(); finish("invalid"); });
    req.on("error", (e) => finish(e.code === "ECONNREFUSED" ? "refused" : "invalid"));
  });
}

function createLocalSiteOsManager({ paths, execPath = process.execPath, port = 3210, start = spawn, timeoutMs = 20000, intervalMs = 250 }) {
  let child = null;
  let pending = null;
  let closed = false;
  const close = () => { closed = true; if (child && child.exitCode === null && !child.killed) child.kill(); };
  const ensure = (url, { tunnel = false } = {}) => {
    if (!isLocalSiteOs(url, port)) return Promise.resolve({ ok: false, skipped: true, error: "Automatyczny start obsługuje tylko lokalny Site OS na domyślnym porcie." });
    if (closed) return Promise.resolve({ ok: false, error: "Aplikacja jest zamykana." });
    if (pending) return pending;
    pending = (async () => {
      const initial = await probeSiteOs(port);
      if (closed) return { ok: false, error: "Aplikacja jest zamykana." };
      if (initial === "ready") return { ok: true, started: false, url: `http://127.0.0.1:${port}` };
      if (initial !== "refused") return { ok: false, error: "Port Site OS jest zajęty lub usługa zwraca nieprawidłową odpowiedź." };
      if (!fs.existsSync(paths.script)) return { ok: false, error: "Brak modułu Site OS w instalacji." };
      let spawnError = "";
      let exited = false;
      try {
        child = start(execPath, [paths.script, ...(tunnel ? ["--tunnel"] : [])], {
          shell: false, stdio: "ignore", windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SITE_OS_HOST: "127.0.0.1", SITE_OS_PORT: String(port), SITE_OS_DATA_DIR: paths.data, SITE_OS_RUNTIME_DIR: paths.runtime, SITE_OS_TOOLS_DIR: paths.tools },
        });
      } catch (error) { return { ok: false, error: `Nie udało się uruchomić Site OS: ${error.message}` }; }
      const owned = child;
      owned.once("error", (error) => { spawnError = `Nie udało się uruchomić Site OS: ${error.message}`; });
      owned.once("exit", () => { exited = true; if (child === owned) child = null; });
      const deadline = Date.now() + timeoutMs;
      while (!closed && Date.now() < deadline) {
        if (spawnError) return { ok: false, error: spawnError };
        if (exited || owned.exitCode !== null) return { ok: false, error: `Site OS zakończył pracę (kod ${owned.exitCode ?? "brak"}).` };
        const ready = await probeSiteOs(port);
        if (closed) break;
        if (ready === "ready" && !exited && owned.exitCode === null) return { ok: true, started: true, url: `http://127.0.0.1:${port}` };
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      if (owned.exitCode === null && !owned.killed) owned.kill();
      return { ok: false, error: closed ? "Aplikacja jest zamykana." : "Site OS nie potwierdził gotowości w wyznaczonym czasie." };
    })().finally(() => { pending = null; });
    return pending;
  };
  return { ensure, close };
}
module.exports = { isLocalSiteOs, probeSiteOs, createLocalSiteOsManager };
