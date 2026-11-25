// Controlled lifecycle for the bundled local JARVIS Forge daemon (loopback-only :3220).
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function isLocalForge(raw, port = 3220) {
  try {
    const u = new URL(String(raw || ""));
    return u.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(u.hostname)
      && u.port === String(port)
      && !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash;
  } catch {
    return false;
  }
}

function probeForge(port) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 1000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (part) => { body += part; if (body.length > 65536) { res.destroy(); finish("invalid"); } });
      res.on("error", () => finish("invalid"));
      res.on("end", () => {
        try {
          const h = JSON.parse(body);
          finish(res.statusCode === 200 && h.ok === true && h.name === "JARVIS Forge" ? "ready" : "invalid");
        } catch {
          finish("invalid");
        }
      });
    });
    req.on("timeout", () => { req.destroy(); finish("invalid"); });
    req.on("error", (e) => finish(e.code === "ECONNREFUSED" ? "refused" : "invalid"));
  });
}

function readRuntimeToken(runtimeDir) {
  try {
    if (!runtimeDir) return undefined;
    const raw = JSON.parse(fs.readFileSync(path.join(runtimeDir, "connection.json"), "utf8"));
    return typeof raw?.token === "string" && raw.token.length > 20 ? raw.token : undefined;
  } catch {
    return undefined;
  }
}

function createLocalForgeManager({ paths, execPath = process.execPath, port = 3220, start = spawn, timeoutMs = 15000, intervalMs = 200 }) {
  let child = null;
  let pending = null;
  let closed = false;
  const close = () => { closed = true; if (child && child.exitCode === null && !child.killed) child.kill(); };
  const withToken = (obj) => {
    const token = readRuntimeToken(paths?.runtime);
    return token ? { ...obj, token } : obj;
  };

  const ensure = (url = `http://127.0.0.1:${port}`) => {
    if (!isLocalForge(url, port)) {
      return Promise.resolve({ ok: false, skipped: true, error: "Automatyczny start obsługuje tylko lokalny JARVIS Forge na 127.0.0.1:3220." });
    }
    if (closed) return Promise.resolve({ ok: false, error: "Aplikacja jest zamykana." });
    if (pending) return pending;
    pending = (async () => {
      const initial = await probeForge(port);
      if (closed) return { ok: false, error: "Aplikacja jest zamykana." };
      if (initial === "ready") return withToken({ ok: true, started: false, url: `http://127.0.0.1:${port}` });
      if (initial !== "refused") return { ok: false, error: "Port JARVIS Forge (3220) jest zajęty przez inną usługę." };
      if (!fs.existsSync(paths.script)) return { ok: false, error: "Brak modułu forge/server.mjs w instalacji." };

      let spawnError = "";
      let exited = false;
      try {
        child = start(execPath, [paths.script], {
          shell: false,
          stdio: "ignore",
          windowsHide: true,
          cwd: paths.defaultRepo || process.cwd(),
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            FORGE_PORT: String(port),
            FORGE_RUNTIME_DIR: paths.runtime,
          },
        });
      } catch (error) {
        return { ok: false, error: `Nie udało się uruchomić JARVIS Forge: ${error.message}` };
      }
      const owned = child;
      owned.once("error", (error) => { spawnError = `Nie udało się uruchomić JARVIS Forge: ${error.message}`; });
      owned.once("exit", () => { exited = true; if (child === owned) child = null; });
      const deadline = Date.now() + timeoutMs;
      while (!closed && Date.now() < deadline) {
        if (spawnError) return { ok: false, error: spawnError };
        if (exited || owned.exitCode !== null) return { ok: false, error: `JARVIS Forge zakończył pracę (kod ${owned.exitCode ?? "brak"}).` };
        const ready = await probeForge(port);
        if (closed) break;
        if (ready === "ready" && !exited && owned.exitCode === null) {
          return withToken({ ok: true, started: true, url: `http://127.0.0.1:${port}` });
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      if (owned.exitCode === null && !owned.killed) owned.kill();
      return { ok: false, error: closed ? "Aplikacja jest zamykana." : "JARVIS Forge nie potwierdził gotowości na czas." };
    })().finally(() => { pending = null; });
    return pending;
  };

  return { ensure, close };
}

module.exports = { isLocalForge, probeForge, createLocalForgeManager };
