import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createLocalSiteOsManager, isLocalSiteOs } = require("../electron/local-siteos.cjs");
async function listen(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { server, port: (server.address() as { port: number }).port };
}
async function close(server: Server) { await new Promise<void>((done, reject) => server.close((e) => e ? reject(e) : done())); }

const tempPaths = () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-site-autostart-"));
  return { dir, script: resolve("site-os/server.mjs"), data: join(dir, "data"), runtime: join(dir, "runtime"), tools: join(dir, "tools") };
};

describe("automatyczny Site OS", () => {
  it("ogranicza autostart do lokalnego URL", () => {
    expect(isLocalSiteOs("http://localhost:3210")).toBe(true);
    for (const url of ["http://example.com:3210", "http://localhost:3211", "http://user@localhost:3210", "https://localhost:3210", "http://localhost:3210/a", "http://localhost:3210/?x=1"]) expect(isLocalSiteOs(url)).toBe(false);
  });
  it("odmawia startu, jeśli na porcie działa inna usługa", async () => {
    const { server, port } = await listen((_req, res) => res.end(JSON.stringify({ ok: true, name: "other", version: "1" })));
    const paths = tempPaths(); const start = vi.fn();
    const manager = createLocalSiteOsManager({ paths, port, start });
    try { expect(await manager.ensure(`http://localhost:${port}`)).toMatchObject({ ok: false }); expect(start).not.toHaveBeenCalled(); }
    finally { manager.close(); await close(server); rmSync(paths.dir, { recursive: true, force: true }); }
  });
  it("wykorzystuje gotową usługę i jej nie zatrzymuje", async () => {
    const { server, port } = await listen((_req, res) => res.end(JSON.stringify({ ok: true, name: "JARVIS Site OS", version: "0.2.1" })));
    const paths = tempPaths(); const start = vi.fn(); const manager = createLocalSiteOsManager({ paths, port, start });
    try { expect(await manager.ensure(`http://localhost:${port}`)).toMatchObject({ ok: true, started: false }); expect(start).not.toHaveBeenCalled(); manager.close(); expect(server.listening).toBe(true); }
    finally { manager.close(); await close(server); rmSync(paths.dir, { recursive: true, force: true }); }
  });
  it("raportuje brak modułu bez uruchamiania procesu", async () => {
    const reserved = await listen((_req, res) => res.end()); const { port } = reserved; await close(reserved.server);
    const paths = tempPaths(); paths.script = join(paths.dir, "brak.mjs"); const start = vi.fn();
    const manager = createLocalSiteOsManager({ paths, port, start });
    try { expect(await manager.ensure(`http://localhost:${port}`)).toMatchObject({ ok: false, error: expect.stringMatching(/Brak modułu/) }); expect(start).not.toHaveBeenCalled(); }
    finally { manager.close(); rmSync(paths.dir, { recursive: true, force: true }); }
  });
  it("nie uruchamia procesu dla zewnętrznego URL", async () => {
    const paths = tempPaths(); const start = vi.fn(); const manager = createLocalSiteOsManager({ paths, start });
    try { expect(await manager.ensure("http://example.com:3210")).toMatchObject({ ok: false, skipped: true }); expect(start).not.toHaveBeenCalled(); }
    finally { manager.close(); rmSync(paths.dir, { recursive: true, force: true }); }
  });
  it("startuje prawdziwy Site OS na odizolowanych danych bez tunelu i współbieżnego duplikatu", async () => {
    const reserved = await listen((_req, res) => res.end()); const { port } = reserved; await close(reserved.server);
    const paths = tempPaths(); let owned: ReturnType<typeof spawn> | undefined;
    const start = vi.fn((cmd: string, args: string[], opts: Parameters<typeof spawn>[2]) => { expect(args).toEqual([paths.script]); owned = spawn(cmd, args, opts); return owned; });
    const manager = createLocalSiteOsManager({ paths, port, execPath: process.execPath, start, timeoutMs: 5000, intervalMs: 20 });
    try {
      const [a, b] = await Promise.all([manager.ensure(`http://127.0.0.1:${port}`), manager.ensure(`http://127.0.0.1:${port}`)]);
      expect(a).toMatchObject({ ok: true, started: true }); expect(b).toEqual(a); expect(start).toHaveBeenCalledTimes(1);
      const response = await fetch(`http://127.0.0.1:${port}/api/health`); expect(await response.json()).toMatchObject({ ok: true, name: "JARVIS Site OS", tunnelUrl: "" });
    } finally {
      const exited = owned && new Promise<void>((done) => owned!.once("exit", () => done())); manager.close(); if (exited) await exited;
      rmSync(paths.dir, { recursive: true, force: true });
    }
  }, 10000);
});
