// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { isAllowedHost, mcpToolName, mcpToolsToDefs, formatMcpResult, McpManager } from "../src/lib/mcp";
import { toolDefs, runTool } from "../src/lib/tools";
import { grantOutboundScope } from "../src/lib/permissions";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop;
});

describe("MCP — funkcje czyste", () => {
  it("isAllowedHost: dokładny host lub subdomena; reszta odrzucona", () => {
    const allow = ["localhost", "mcp.googleapis.com"];
    expect(isAllowedHost("http://localhost:9000/mcp", allow)).toBe(true);
    expect(isAllowedHost("https://srv.mcp.googleapis.com/x", allow)).toBe(true);
    expect(isAllowedHost("https://mcp.googleapis.com.attacker.tld/x", allow)).toBe(false);
    expect(isAllowedHost("https://evil.example/x", allow)).toBe(false);
    expect(isAllowedHost("nie-url", allow)).toBe(false);
  });

  it("mcpToolName sanityzuje do [a-z0-9_]", () => {
    expect(mcpToolName("Google Cal", "create-event!")).toBe("mcp_google_cal_create_event");
  });

  it("mcpToolsToDefs mapuje inputSchema→input_schema i prefiksuje", () => {
    const defs = mcpToolsToDefs({ tools: [{ name: "addEvent", description: "Dodaj", inputSchema: { type: "object", properties: { title: {} } } }] }, "gcal");
    expect(defs[0].def.name).toBe("mcp_gcal_addevent");
    expect(defs[0].original).toBe("addEvent");
    expect(defs[0].def.input_schema).toEqual({ type: "object", properties: { title: {} } });
  });

  it("formatMcpResult wyciąga tekst z content[]", () => {
    expect(formatMcpResult({ content: [{ type: "text", text: "OK gotowe" }] })).toBe("OK gotowe");
    expect(formatMcpResult({ content: [{ type: "text", text: "boom" }], isError: true })).toMatch(/Błąd narzędzia MCP/);
  });
});

describe("MCP — McpManager (mock JSON-RPC)", () => {
  function rpcMock(toolsByMethod: { tools: any[]; callResult: any }) {
    return vi.fn(async (_url: string, opts: any) => {
      const { method } = JSON.parse(opts.body);
      if (method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } }), { status: 200 });
      if (method === "tools/list") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: toolsByMethod.tools } }), { status: 200 });
      if (method === "tools/call") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 3, result: toolsByMethod.callResult }), { status: 200 });
      return new Response("{}", { status: 200 });
    });
  }

  it("ładuje narzędzia z mock-serwera i wykonuje wywołanie przez runTool", async () => {
    vi.stubGlobal("fetch", rpcMock({
      tools: [{ name: "ping", description: "pinguje", inputSchema: { type: "object", properties: {} } }],
      callResult: { content: [{ type: "text", text: "pong" }] },
    }));
    const mgr = new McpManager();
    const loaded = await mgr.loadAll([{ name: "test", url: "http://localhost:9100/mcp" }], ["localhost"]);
    expect(loaded.map((t) => t.toolName)).toContain("mcp_test_ping");
    expect(toolDefs.some((d) => d.name === "mcp_test_ping")).toBe(true); // zarejestrowane dla modelu
    grantOutboundScope("*"); // narzędzie dynamiczne = fail-safe outbound; test bada wykonanie
    const out = await runTool("mcp_test_ping", {});
    expect(out).toBe("pong"); // wykonane przez serwer MCP
  });

  it("odrzuca serwer spoza allowlisty (nie ładuje narzędzi, nie woła sieci)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mgr = new McpManager();
    const loaded = await mgr.loadAll([{ name: "evil", url: "https://evil.example/mcp" }], ["localhost"]);
    expect(loaded).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("graceful: serwer niedostępny → brak narzędzi, bez wyjątku", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const mgr = new McpManager();
    const loaded = await mgr.loadAll([{ name: "down", url: "http://localhost:9200/mcp" }], ["localhost"]);
    expect(loaded).toEqual([]);
  });

  it("rejestruje i wywołuje lokalne narzędzie stdio przez most desktopowy", async () => {
    const mcpStdioConnect = vi.fn(async () => ({
      ok: true,
      tools: [{ name: "local_ping", description: "Lokalny test", inputSchema: { type: "object", properties: {} } }],
    }));
    const mcpStdioCall = vi.fn(async () => ({
      ok: true,
      result: { content: [{ type: "text", text: "local-pong" }] },
    }));
    (window as unknown as { jarvisDesktop: unknown }).jarvisDesktop = {
      platform: "linux",
      mcpStdioConnect,
      mcpStdioCall,
    };

    const mgr = new McpManager();
    const loaded = await mgr.loadAll([{ name: "local-fixture", command: "node", args: ["server.mjs"] }]);
    expect(loaded.map((tool) => tool.toolName)).toContain("mcp_local_fixture_local_ping");
    grantOutboundScope("*");
    await expect(runTool("mcp_local_fixture_local_ping", {})).resolves.toBe("local-pong");
    expect(mcpStdioConnect).toHaveBeenCalledOnce();
    expect(mcpStdioCall).toHaveBeenCalledWith("local-fixture", "local_ping", {});
  });
});
