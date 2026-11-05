// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { isAllowedHost, mcpToolName, mcpToolsToDefs, formatMcpResult, McpManager } from "../src/lib/mcp";
import { toolDefs, runTool } from "../src/lib/tools";
import { grantOutboundScope, hasOutboundScope } from "../src/lib/permissions";

const managers: McpManager[] = [];
function manager() { const value = new McpManager(); managers.push(value); return value; }
afterEach(async () => {
  await Promise.all(managers.splice(0).map(m => m.stopAll()));
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
    expect(isAllowedHost("ftp://localhost/mcp", allow)).toBe(false);
    expect(isAllowedHost("http://user:password@localhost/mcp", allow)).toBe(false);
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
      const { method, id } = JSON.parse(opts.body);
      if (method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { capabilities: {} } }), { status: 200 });
      if (method === "tools/list") return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: toolsByMethod.tools } }), { status: 200 });
      if (method === "tools/call") return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: toolsByMethod.callResult }), { status: 200 });
      return new Response("{}", { status: 200 });
    });
  }

  it("ładuje narzędzia z mock-serwera i wykonuje wywołanie przez runTool", async () => {
    vi.stubGlobal("fetch", rpcMock({
      tools: [{ name: "ping", description: "pinguje", inputSchema: { type: "object", properties: {} } }],
      callResult: { content: [{ type: "text", text: "pong" }] },
    }));
    const mgr = manager();
    const loaded = await mgr.loadAll([{ name: "test", url: "http://localhost:9100/mcp" }], ["localhost"]);
    expect(loaded.map((t) => t.toolName)).toContain("mcp_test_ping");
    expect(toolDefs.some((d) => d.name === "mcp_test_ping")).toBe(true); // zarejestrowane dla modelu
    grantOutboundScope(["mcp_test_ping"]); // narzędzie dynamiczne = fail-safe outbound; test bada wykonanie
    const out = await runTool("mcp_test_ping", {});
    expect(out).toBe("pong"); // wykonane przez serwer MCP
  });

  it("odrzuca serwer spoza allowlisty (nie ładuje narzędzi, nie woła sieci)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mgr = manager();
    const loaded = await mgr.loadAll([{ name: "evil", url: "https://evil.example/mcp" }], ["localhost"]);
    expect(loaded).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("graceful: serwer niedostępny → brak narzędzi, bez wyjątku", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const mgr = manager();
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

    const mgr = manager();
    const loaded = await mgr.loadAll([{ name: "local-fixture", command: "node", args: ["server.mjs"] }]);
    expect(loaded.map((tool) => tool.toolName)).toContain("mcp_local_fixture_local_ping");
    grantOutboundScope(["mcp_local_fixture_local_ping"]);
    await expect(runTool("mcp_local_fixture_local_ping", {})).resolves.toBe("local-pong");
    expect(mcpStdioConnect).toHaveBeenCalledOnce();
    expect(mcpStdioCall).toHaveBeenCalledWith("local-fixture", "local_ping", {});
  });
  it("revokes a pending call, removes scopes and rejects its late response", async () => {
    let release: (value: Response) => void = () => {}, entered: () => void = () => {};
    const awaitingCall = new Promise<void>(r => entered = r);
    const base = rpcMock({ tools: [{ name: "pending", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }], callResult: {} });
    const fetchMock = vi.fn(async (url: string, opts: any) => {
      if (JSON.parse(opts.body).method === "tools/call") { entered(); return new Promise<Response>(r => release = r); }
      return base(url, opts);
    });
    vi.stubGlobal("fetch", fetchMock);
    const mgr = manager(), srv = { name: "revocable", url: "http://localhost:9100/mcp" };
    await mgr.loadAll([srv], ["localhost"]);
    grantOutboundScope(["mcp_revocable_pending"]);
    const pending = mgr.call(srv, "pending", {}).catch(e => e);
    await awaitingCall; await mgr.revoke(srv.name);
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(hasOutboundScope("mcp_revocable_pending")).toBe(false);
    expect(toolDefs.some(d => d.name === "mcp_revocable_pending")).toBe(false);
    release(new Response(JSON.stringify({ result: { content: [{ type: "text", text: "late" }] } })));
    await expect(mgr.call(srv, "pending", {})).rejects.toThrow(/wycofano/);
    expect(fetchMock.mock.calls.filter(([, opts]) => JSON.parse(opts.body).method === "tools/call")).toHaveLength(1);
  });

  it("passes task cancellation to HTTP and never shares the application token", async () => {
    const fetchMock = rpcMock({ tools: [{ name: "safe", inputSchema: { type: "object" } }], callResult: { content: [{ type: "text", text: "ok" }] } });
    vi.stubGlobal("fetch", fetchMock);
    const mgr = manager(), srv = { name: "header-test", url: "https://allowed.example/mcp", token: "explicit-test-token" };
    await mgr.loadAll([srv], ["allowed.example"]);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.headers).not.toHaveProperty("x-app-token");
      expect(options.headers.authorization).toBe("Bearer explicit-test-token");
      expect(options.redirect).toBe("error");
      expect(options.credentials).toBe("omit");
    }
    const controller = new AbortController(); controller.abort();
    const calls = fetchMock.mock.calls.length;
    await expect(mgr.call(srv, "safe", {}, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("rejects oversized schemas instead of broadening their validation", () => {
    expect(mcpToolsToDefs({ tools: [{ name: "huge", inputSchema: { description: "x".repeat(33000) } }] }, "test")).toEqual([]);
  });

  it("rejects a response with the wrong JSON-RPC id before registering any tool", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "another-request", result: { capabilities: {} } }))));
    expect(await manager().loadAll([{ name: "wrong-id", url: "http://localhost:9100/mcp" }], ["localhost"])).toEqual([]);
  });

});
