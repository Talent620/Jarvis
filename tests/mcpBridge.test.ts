import { describe, it, expect, vi } from "vitest";
import { McpStdioBridge, validateStdioConfig, type StdioMcpTransport } from "../src/lib/mcpBridge";

describe("validateStdioConfig — zgodność z allowlistą electron/mcp-stdio.cjs", () => {
  it("akceptuje dozwolone programy (node/npx/python3/uvx) i czyści env", () => {
    const cfg = validateStdioConfig({
      name: "fs-server",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      env: { API_MODE: "readonly", "BAD-KEY": "ignored" },
    });
    expect(cfg.name).toBe("fs-server");
    expect(cfg.command).toBe("npx");
    expect(cfg.env).toEqual({ API_MODE: "readonly" });
  });

  it("odrzuca program spoza allowlisty (np. bash/sh/curl)", () => {
    expect(() => validateStdioConfig({ name: "bad", command: "bash", args: ["-c", "id"] })).toThrow(/allowliście/i);
  });

  it("odrzuca argumenty z CR/LF/NUL", () => {
    expect(() => validateStdioConfig({ name: "bad", command: "node", args: ["ok\nrm -rf /"] })).toThrow(/sterujące/i);
  });
});

describe("McpStdioBridge — cykl życia connect → call → disconnect", () => {
  it("łączy, mapuje narzędzia MCP i formatuje wynik tools/call", async () => {
    const transport: StdioMcpTransport = {
      connect: vi.fn(async () => ({
        ok: true,
        tools: [{ name: "read_note", description: "Czyta notatkę", inputSchema: { type: "object", properties: {} } }],
      })),
      call: vi.fn(async () => ({
        ok: true,
        result: { content: [{ type: "text", text: "Treść z serwera MCP" }] },
      })),
      close: vi.fn(async () => ({ ok: true })),
    };

    const bridge = new McpStdioBridge(transport);
    const conn = await bridge.connectServer(
      { name: "notes", command: "node", args: ["server.js"] },
      { register: false },
    );
    expect(conn.ok).toBe(true);
    expect(conn.tools[0].name).toBe("mcp_notes_read_note");
    expect(bridge.listConnectedServers()).toEqual(["notes"]);

    const out = await bridge.callTool("notes", "read_note", {});
    expect(out).toBe("Treść z serwera MCP");

    expect(await bridge.disconnect("notes")).toBe(true);
    expect(bridge.listConnectedServers()).toEqual([]);
  });
});
