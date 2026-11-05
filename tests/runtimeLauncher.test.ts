import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";

const require = createRequire(import.meta.url);
const { createRuntimeLauncher, checkRuntimeHealth } = require("../electron/runtime-launcher.cjs");
const dirs: string[] = [];
const servers: Server[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "jarvis-launcher-")); dirs.push(dir); return dir; };
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function child() { const emitter = new EventEmitter() as EventEmitter & { unref: () => void }; emitter.unref = vi.fn(); return emitter; }
const source = resolve("server/runtime/cli.mjs");

describe("local runtime startup", () => {
  it("reuses an authenticated running service without starting another", async () => {
    const startService = vi.fn(); const spawn = vi.fn();
    const launcher = createRuntimeLauncher({ platform: "linux", readConnection: () => ({ url: "http://127.0.0.1:1", token: "secret" }), checkHealth: () => true, startService, spawn });
    await expect(launcher.start()).resolves.toEqual({ ok: true });
    expect(startService).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
  });
  it("waits for the installer launcher and coalesces concurrent startup requests", async () => {
    let calls = 0; const spawn = vi.fn(); const startService = vi.fn();
    const launcher = createRuntimeLauncher({ platform: "linux", env: { JARVIS_RUNTIME_BOOTSTRAP: "launcher" }, readConnection: () => ({}), checkHealth: () => ++calls >= 4,
      delay: async () => {}, startService, spawn });
    expect(await Promise.all([launcher.start(), launcher.start(), launcher.start()])).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(startService).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
  });
  it("tries the user service and falls back to a detached worker with private log", async () => {
    const dir = temp(); let active = false; const worker = child(); const startService = vi.fn(async () => false);
    const spawn = vi.fn(() => { active = true; return worker; });
    const launcher = createRuntimeLauncher({ platform: "linux", script: source, execPath: "/electron", env: { XDG_STATE_HOME: dir, JARVIS_RUNTIME_DATA_DIR: join(dir, "data") },
      readConnection: () => ({}), checkHealth: () => active, startService, spawn, delay: async () => {} });
    await expect(launcher.start()).resolves.toEqual({ ok: true });
    expect(startService).toHaveBeenCalledOnce();
    const [exe, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { detached: boolean; env: Record<string, string>; stdio: unknown[] }];
    expect(exe).toBe("/electron"); expect(args).toEqual([source, "start", "--foreground"]);
    expect(options.detached).toBe(true); expect(options.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(options.env.JARVIS_RUNTIME_DATA_DIR).toBe(join(dir, "data")); expect(worker.unref).toHaveBeenCalledOnce();
    expect(statSync(join(dir, "jarvis", "runtime.log")).mode & 0o077).toBe(0);
  });
  it("reports failure without throwing when a worker cannot start", async () => {
    const dir = temp(); const launcher = createRuntimeLauncher({ platform: "linux", script: source, env: { XDG_STATE_HOME: dir },
      readConnection: () => null, checkHealth: () => false, startService: async () => false, spawn: () => { throw new Error("unavailable"); } });
    await expect(launcher.start()).resolves.toMatchObject({ ok: false });
  });
  it("health requires the bearer token and does not treat 401 as ready", async () => {
    const server = createServer((req, res) => { res.writeHead(req.headers.authorization === "Bearer correct" ? 200 : 401); res.end("{}"); });
    servers.push(server); await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("no server");
    const url = `http://127.0.0.1:${address.port}`;
    await expect(checkRuntimeHealth({ url, token: "incorrect" })).resolves.toBe(false);
    await expect(checkRuntimeHealth({ url, token: "correct" })).resolves.toBe(true);
  });
  it("starts the real server in a separate process and can stop it cleanly", async () => {
    const dir = temp(); const dataDir = join(dir, "data");
    const readConnection = () => { try { return JSON.parse(readFileSync(join(dataDir, "connection.json"), "utf8")); } catch { return null; } };
    const launcher = createRuntimeLauncher({ platform: "linux", script: source, execPath: process.execPath,
      env: { ...process.env, XDG_STATE_HOME: dir, JARVIS_RUNTIME_DATA_DIR: dataDir, JARVIS_RUNTIME_PORT: "0" },
      readConnection, startService: async () => false });
    const result = await launcher.start();
    try {
      expect(result).toEqual({ ok: true });
      const conn = readConnection(); expect(conn).not.toBeNull();
      const response = await fetch(`${conn.url}/v1/status`, { headers: { Authorization: `Bearer ${conn.token}` } });
      expect(response.status).toBe(200);
    } finally {
      const conn = readConnection();
      if (conn) await fetch(`${conn.url}/v1/stop`, { method: "POST", headers: { Authorization: `Bearer ${conn.token}` } }).catch(() => {});
    }
  }, 15000);
});
