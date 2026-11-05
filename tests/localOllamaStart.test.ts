import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createLocalOllamaManager, isDefaultLocalOllama } = require("../electron/local-ollama.cjs");

async function listen(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { server, port: (server.address() as { port: number }).port };
}
async function close(server: Server) { await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); }

const fixture = `const http=require('http'); http.createServer((req,res)=>{if(req.url==='/api/tags'){res.setHeader('content-type','application/json');res.end(JSON.stringify({models:[]}));}else{res.statusCode=404;res.end();}}).listen(Number(process.env.FIXTURE_PORT),'127.0.0.1');`;

describe("bezpieczny start lokalnej Ollamy", () => {
  it("odrzuca inne adresy, protokoły i ukryte składniki URL", () => {
    expect(isDefaultLocalOllama("http://localhost:11434")).toBe(true);
    expect(isDefaultLocalOllama("http://127.0.0.1:11434/")).toBe(true);
    for (const url of ["http://example.com:11434", "http://192.168.1.2:11434", "https://localhost:11434", "http://localhost:11435", "http://user@localhost:11434", "http://localhost:11434/path", "http://localhost:11434/?x=1", ""]) expect(isDefaultLocalOllama(url)).toBe(false);
  });
  it("używa istniejącego serwera i nie przejmuje ani nie zabija procesu", async () => {
    const { server, port } = await listen((_req, res) => { res.end(JSON.stringify({ models: [] })); });
    const start = vi.fn();
    const manager = createLocalOllamaManager({ port, start });
    try {
      expect(await manager.ensure(`http://localhost:${port}`)).toEqual({ ok: true, started: false });
      expect(start).not.toHaveBeenCalled();
      manager.close();
      expect(server.listening).toBe(true);
    } finally { manager.close(); await close(server); }
  });
  it("nie uruchamia Ollamy, gdy port zajmuje inna usługa", async () => {
    const { server, port } = await listen((_req, res) => { res.end("not ollama"); });
    const start = vi.fn();
    const manager = createLocalOllamaManager({ port, start });
    try {
      expect(await manager.ensure(`http://127.0.0.1:${port}`)).toMatchObject({ ok: false });
      expect(start).not.toHaveBeenCalled();
    } finally { manager.close(); await close(server); }
  });
  it("uruchamia tylko jedną instancję, czeka na /api/tags i sprząta swój proces", async () => {
    const reservation = await listen((_req, res) => res.end());
    const { port } = reservation;
    await close(reservation.server);
    let owned: ReturnType<typeof spawn> | undefined;
    const start = vi.fn((_command: string, _args: string[], opts: Parameters<typeof spawn>[2]) => {
      expect(_command).toBe("ollama");
      expect(_args).toEqual(["serve"]);
      expect(opts?.shell).toBe(false);
      expect(opts?.env?.OLLAMA_HOST).toBe(`127.0.0.1:${port}`);
      owned = spawn(process.execPath, ["-e", fixture], { ...opts, env: { ...opts?.env, FIXTURE_PORT: String(port) } });
      return owned;
    });
    const manager = createLocalOllamaManager({ port, start, timeoutMs: 5000, intervalMs: 20 });
    try {
      const [a, b] = await Promise.all([manager.ensure(`http://localhost:${port}`), manager.ensure(`http://localhost:${port}`)]);
      expect(a).toEqual({ ok: true, started: true });
      expect(b).toEqual(a);
      expect(start).toHaveBeenCalledTimes(1);
      expect(await manager.ensure(`http://localhost:${port}`)).toEqual({ ok: true, started: false });
    } finally {
      const exited = owned && new Promise<void>((resolve) => owned!.once("exit", () => resolve()));
      manager.close();
      if (exited) await exited;
    }
  }, 10000);
  it("zgłasza brak programu bez awarii aplikacji", async () => {
    const reservation = await listen((_req, res) => res.end());
    const { port } = reservation;
    await close(reservation.server);
    const manager = createLocalOllamaManager({ port, start: () => spawn("jarvis-missing-ollama-test", []), timeoutMs: 1000, intervalMs: 20 });
    try { expect(await manager.ensure(`http://localhost:${port}`)).toMatchObject({ ok: false, error: expect.stringMatching(/Nie znaleziono/) }); }
    finally { manager.close(); }
  });
});
