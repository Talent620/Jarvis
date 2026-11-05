import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { cleanConfig, createStdioMcpManager } = require("../electron/mcp-stdio.cjs");
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("MCP stdio", () => {
  it("ogranicza program i katalog roboczy", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-mcp-config-"));
    temporary.push(root);
    expect(() => cleanConfig(root, { name: "test", command: "bash" })).toThrow(/allowliście/);
    expect(() => cleanConfig(root, { name: "test", command: "node", cwd: ".." })).toThrow(/poza katalog/);
    expect(cleanConfig(root, { name: "test", command: "node", args: ["server.mjs"] })).toMatchObject({
      name: "test",
      command: "node",
      args: ["server.mjs"],
    });
  });

  it("łączy lokalny serwer, odkrywa i wywołuje narzędzie", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-mcp-runtime-"));
    temporary.push(root);
    mkdirSync(join(root, "server"));
    const mcpModule = pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/mcp.js")).href;
    const stdioModule = pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/stdio.js")).href;
    writeFileSync(join(root, "server", "fixture.mjs"), `
      import { McpServer } from "${mcpModule}";
      import { StdioServerTransport } from "${stdioModule}";
      const server = new McpServer({ name: "fixture", version: "1.0.0" });
      server.registerTool("ping", { description: "Test połączenia" }, async () => ({
        content: [{ type: "text", text: "pong" }]
      }));
      await server.connect(new StdioServerTransport());
    `);
    const manager = createStdioMcpManager({ root });

    try {
      const connected = await manager.connect({
        name: "fixture",
        command: "node",
        args: [join(root, "server", "fixture.mjs")],
      });
      expect(connected).toMatchObject({ ok: true });
      expect(connected.tools?.map((tool: { name: string }) => tool.name)).toContain("ping");
      const called = await manager.call("fixture", "ping", {});
      expect(called).toMatchObject({
        ok: true,
        result: { content: [{ type: "text", text: "pong" }] },
      });
    } finally {
      await manager.closeAll();
    }
  }, 30_000);
  it("cleans its spawned process after a real initialization timeout", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-mcp-timeout-")); temporary.push(root);
    const pidFile = join(root, "pid");
    const fixture = join(root, "hung.cjs");
    writeFileSync(fixture, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
    const manager = createStdioMcpManager({ root, connectTimeout: 300 });
    try {
      expect(await manager.connect({ name: "hung", command: "node", args: [fixture] })).toMatchObject({ ok: false });
      const pid = Number(readFileSync(pidFile, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
      expect(await manager.call("hung", "anything", {})).toMatchObject({ ok: false });
    } finally { await manager.closeAll(); }
  }, 15000);

  it("STOP cancels a real in-flight SDK call and closes its owned server", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-mcp-stop-")); temporary.push(root);
    const pidFile = join(root, "pid"), started = join(root, "started"), fixture = join(root, "server.mjs");
    const mcpModule = pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/mcp.js")).href;
    const stdioModule = pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/stdio.js")).href;
    writeFileSync(fixture, `
      import { writeFileSync } from 'node:fs';
      import { McpServer } from ${JSON.stringify(mcpModule)};
      import { StdioServerTransport } from ${JSON.stringify(stdioModule)};
      writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      const server = new McpServer({ name: 'stop-fixture', version: '1' });
      server.registerTool('wait', { description: 'Wait until cancelled' }, async () => {
        writeFileSync(${JSON.stringify(started)}, 'started');
        return new Promise(() => {});
      });
      await server.connect(new StdioServerTransport());
    `);
    const manager = createStdioMcpManager({ root });
    try {
      expect(await manager.connect({ name: "stop-fixture", command: "node", args: [fixture] })).toMatchObject({ ok: true });
      expect(await manager.call("stop-fixture", "not-discovered", {})).toMatchObject({ ok: false });
      const pending = manager.call("stop-fixture", "wait", {});
      for (let i = 0; i < 100; i++) { try { if (readFileSync(started, "utf8")) break; } catch {} await new Promise(r => setTimeout(r, 10)); }
      expect(readFileSync(started, "utf8")).toBe("started");
      await manager.abortAll();
      expect(await pending).toMatchObject({ ok: false, uncertain: true });
      expect(() => process.kill(Number(readFileSync(pidFile, "utf8")), 0)).toThrow();
      expect(await manager.call("stop-fixture", "wait", {})).toMatchObject({ ok: false });
    } finally { await manager.closeAll(); }
  }, 15000);

});
