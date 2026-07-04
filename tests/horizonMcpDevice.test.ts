// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { httpMcpDevice } from "../src/lib/horizon/mcpDevice";
import { deviceExecutor } from "../src/lib/horizon/deviceNode";
import { climbLadder } from "../src/lib/horizon/truthLadder";
import type { MissionStep } from "../src/lib/horizon/types";

// Transport HTTP-MCP węzła „device": testowany przeciwko STUBOWI fetch —
// uczciwie: to dowód poprawności transportu i kontraktu, NIE testu fizycznego sprzętu.

const NOW = 1_700_000_000_000;
const realFetch = globalThis.fetch;

function stubFetch(handler: (url: string, body: any) => { status?: number; json?: unknown }) {
  globalThis.fetch = vi.fn(async (url: any, init?: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const out = handler(String(url), body);
    return {
      ok: (out.status ?? 200) >= 200 && (out.status ?? 200) < 300,
      status: out.status ?? 200,
      json: async () => out.json ?? null,
    } as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ALLOW = ["localhost", "192.168.1.50"];

describe("httpMcpDevice — kontrakt i bezpieczeństwo transportu", () => {
  it("host spoza allowlisty → isError BEZ wywołania sieci (fail-closed)", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const dev = httpMcpDevice({ url: "http://zly-host.example.com/mcp", allowlist: ALLOW });
    const r = await dev.call("set_state", { key: "led", value: "on" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/allowlist/);
    expect(spy).not.toHaveBeenCalled(); // zero sieci
  });

  it("poprawne tools/call: JSON-RPC 2.0, wynik przechodzi 1:1 (content/isError)", async () => {
    let seen: any = null;
    stubFetch((_url, body) => {
      seen = body;
      return { json: { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ led: "on" }) }] } } };
    });
    const dev = httpMcpDevice({ url: "http://192.168.1.50/mcp", allowlist: ALLOW });
    const r = await dev.call("read_state", { key: "led" });
    expect(seen.method).toBe("tools/call");
    expect(seen.params).toEqual({ name: "read_state", arguments: { key: "led" } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0].text)).toEqual({ led: "on" });
  });

  it("HTTP 500 / błąd RPC / zły kształt / wyjątek sieci → isError (nigdy wyjątek)", async () => {
    const dev = httpMcpDevice({ url: "http://192.168.1.50/mcp", allowlist: ALLOW });

    stubFetch(() => ({ status: 500 }));
    expect((await dev.call("set_state", {})).isError).toBe(true);

    stubFetch((_u, b) => ({ json: { jsonrpc: "2.0", id: b.id, error: { message: "boom" } } }));
    const rpcErr = await dev.call("set_state", {});
    expect(rpcErr.isError).toBe(true);
    expect(rpcErr.content[0].text).toMatch(/boom/);

    stubFetch((_u, b) => ({ json: { jsonrpc: "2.0", id: b.id, result: { totally: "wrong" } } }));
    expect((await dev.call("set_state", {})).isError).toBe(true);

    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const down = await dev.call("set_state", {});
    expect(down.isError).toBe(true);
    expect(down.content[0].text).toMatch(/niedostępne/);
  });
});

describe("httpMcpDevice + drabina prawdy — ten sam adapter co emulator", () => {
  const step: MissionStep = {
    id: "s1",
    node: "device",
    capability: "set_state",
    args: { key: "led", value: "on" },
    expect: { led: "on" },
    correlationId: "c1",
  };

  it("urządzenie faktycznie zmienia stan → read-back potwierdza → CONFIRMED", async () => {
    const state: Record<string, unknown> = { led: "off" };
    stubFetch((_u, body) => {
      const { name, arguments: a } = body.params;
      if (name === "set_state") {
        state[String(a.key)] = a.value;
        return { json: { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ ack: true }) }] } } };
      }
      return { json: { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ led: state.led }) }] } } };
    });
    const exec = deviceExecutor(httpMcpDevice({ url: "http://192.168.1.50/mcp", allowlist: ALLOW }));
    const r = await exec(step);
    const outcome = climbLadder({ actuated: r.actuated, expect: step.expect, readback: r.readback, now: NOW });
    expect(outcome.state).toBe("CONFIRMED");
  });

  it("urządzenie ACK-uje, ale stan się NIE zmienił → ATTEMPTED (transport nie oszuka drabiny)", async () => {
    stubFetch((_u, body) => {
      const { name } = body.params;
      if (name === "set_state") {
        return { json: { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ ack: true }) }] } } };
      }
      return { json: { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ led: "off" }) }] } } };
    });
    const exec = deviceExecutor(httpMcpDevice({ url: "http://192.168.1.50/mcp", allowlist: ALLOW }));
    const r = await exec(step);
    const outcome = climbLadder({ actuated: r.actuated, expect: step.expect, readback: r.readback, now: NOW });
    expect(outcome.state).toBe("ATTEMPTED");
  });
});
