import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
