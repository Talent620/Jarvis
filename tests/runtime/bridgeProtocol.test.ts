// BrowserBridge (M8): protocol validation, pairing, tokens, origin and loopback checks, and the
// server with a WebSocket client standing in for the extension.
import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { Pairing, TokenStore, originAllowed, parseExtensionMessage, isLoopback, type TokenRecord } from "../../src/node/bridge/protocol";
import { BridgeServer } from "../../src/node/bridge/server";
import type { EnvEvent } from "../../src/lib/runtime/env/types";

const EXT = "abcdefghijklmnopabcdefghijklmnop";

describe("messages", () => {
  it("accepts well-formed messages and rejects everything else", () => {
    expect(parseExtensionMessage(JSON.stringify({ type: "hello", v: 1, browser: "chromium", extensionId: EXT, pairCode: "123456" }))).toMatchObject({ type: "hello", pairCode: "123456" });
    expect(parseExtensionMessage(JSON.stringify({ type: "result", id: 3, ok: true, data: { a: 1 } }))).toMatchObject({ type: "result", id: 3 });
    expect(parseExtensionMessage(JSON.stringify({ type: "event", event: "tab", tabId: 1, url: "https://x", title: "X" }))).toMatchObject({ event: "tab" });
    for (const bad of [
      "not json", "[]", JSON.stringify({ type: "hello", v: 1, browser: "safari", extensionId: EXT }),
      JSON.stringify({ type: "hello", v: 1, browser: "chromium", extensionId: EXT, pairCode: "12a456" }),
      JSON.stringify({ type: "result", id: "1", ok: true }), JSON.stringify({ type: "exec", code: "rm -rf /" }),
      JSON.stringify({ type: "event", event: "tab", tabId: 1, url: "x".repeat(5000), title: "" }), "x".repeat(70_000),
    ]) expect(parseExtensionMessage(bad), bad.slice(0, 40)).toBeNull();
  });

  it("only extension origins on loopback may connect", () => {
    expect(originAllowed(`chrome-extension://${EXT}`)).toBe(true);
    expect(originAllowed("moz-extension://1b2c3d4e-aaaa-bbbb-cccc-1234567890ab")).toBe(true);
    for (const o of ["https://evil.example", "http://127.0.0.1:47823", "null", undefined, `chrome-extension://${EXT}/x`]) expect(originAllowed(o)).toBe(false);
    expect(originAllowed(`chrome-extension://${EXT}`, ["otherextensionidotherextensionid"])).toBe(false);
    expect(isLoopback("127.0.0.1") && isLoopback("::1") && !isLoopback("192.168.1.10")).toBe(true);
  });
});

describe("pairing and tokens", () => {
  it("a code works once, expires, and stops after a few wrong attempts", () => {
    let t = 0;
    const p = new Pairing(1000, 3, () => t);
    const code = p.issue();
    expect(code).toMatch(/^\d{6}$/);
    expect(p.consume(code)).toBe(true);
    expect(p.consume(code)).toBe(false);
    const c2 = p.issue();
    t = 2000;
    expect(p.consume(c2)).toBe(false);
    t = 0;
    const c3 = p.issue();
    const wrong = c3 === "000000" ? "000001" : "000000";
    expect([p.consume(wrong), p.consume(wrong), p.consume(wrong), p.consume(c3)]).toEqual([false, false, false, false]);
  });

  it("tokens are stored as hashes, bound to one extension, and revocable", () => {
    let saved: TokenRecord[] = [];
    const store = new TokenStore([], (r) => { saved = r; });
    const token = store.issue(EXT, "chromium");
    expect(JSON.stringify(saved)).not.toContain(token);
    expect(store.verify(token, EXT)).toBe(true);
    expect(store.verify(token, "anotherextensionanotherextension")).toBe(false);
    expect(store.verify("not-a-token", EXT)).toBe(false);
    expect(new TokenStore(saved).verify(token, EXT)).toBe(true); // survives a restart
    store.revoke(EXT);
    expect(store.verify(token, EXT)).toBe(false);
  });
});

describe("bridge server with a stand-in extension", () => {
  let server: BridgeServer | null = null;
  afterEach(async () => { await server?.close(); server = null; });

  async function start(opts: Partial<ConstructorParameters<typeof BridgeServer>[0]> = {}) {
    const pairing = new Pairing();
    const tokens = new TokenStore();
    server = new BridgeServer({ tokens, pairing, helloTimeoutMs: 300, commandTimeoutMs: 300, ...opts });
    const port = await server.start();
    return { port, pairing, tokens, env: server.env };
  }

  function extension(port: number, origin = `chrome-extension://${EXT}`) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`, { origin });
    const inbox: Record<string, unknown>[] = [];
    ws.on("message", (d) => inbox.push(JSON.parse(String(d))));
    const next = async (pred: (m: Record<string, unknown>) => boolean, ms = 1000) => {
      const t0 = Date.now();
      for (;;) {
        const hit = inbox.find(pred);
        if (hit) { inbox.splice(inbox.indexOf(hit), 1); return hit; }
        if (Date.now() - t0 > ms) throw new Error("no such message");
        await new Promise((r) => setTimeout(r, 5));
      }
    };
    const opened = new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("unexpected-response", (_req, r) => rej(new Error(`HTTP ${r.statusCode}`))); ws.once("error", rej); });
    const closed = new Promise<number>((res) => ws.once("close", (code) => res(code)));
    return { ws, next, opened, closed, send: (m: unknown) => ws.send(JSON.stringify(m)) };
  }

  it("pairs with the code, gets a token, reconnects with it, answers commands", async () => {
    const { port, pairing, env } = await start();
    const code = pairing.issue();
    const a = extension(port);
    await a.opened;
    a.send({ type: "hello", v: 1, browser: "chromium", extensionId: EXT, pairCode: code });
    const welcome = await a.next((m) => m.type === "welcome");
    expect(welcome.token).toMatch(/^[0-9a-f]{64}$/);
    expect(env.connected).toBe(true);
    expect((await env.capabilities())[0]).toMatchObject({ id: "browser.bridge", status: "available" });
    a.ws.close();
    await a.closed;
    expect(env.connected).toBe(false);

    const b = extension(port);
    await b.opened;
    b.send({ type: "hello", v: 1, browser: "chromium", extensionId: EXT, token: welcome.token });
    expect(await b.next((m) => m.type === "welcome")).not.toHaveProperty("token", expect.anything());
    // Commands go out as cmd messages, results come back by id.
    const events: EnvEvent[] = [];
    env.onEvent((e) => events.push(e));
    const page = env.read({ kind: "page" });
    const cmd = await b.next((m) => m.type === "cmd");
    expect(cmd).toMatchObject({ method: "tab.get" });
    b.send({ type: "result", id: cmd.id, ok: true, data: { tabId: 7, url: "https://www.youtube.com/watch?v=x", title: "Film" } });
    expect(await page).toMatchObject({ open: true, url: "https://www.youtube.com/watch?v=x", title: "Film" });
    b.send({ type: "event", event: "selection", tabId: 7, text: "Łódź" });
    b.send({ type: "event", event: "tab", tabId: 8, url: "https://example.com/", title: "Other" });
    await new Promise((r) => setTimeout(r, 30));
    expect(events.map((e) => e.type)).toEqual(["navigation", "selection", "navigation"]);
    expect(await env.act({ kind: "browser.navigate", url: "javascript:alert(1)" })).toMatchObject({ status: "blocked" });
    // No answer from the extension: a failure with a reason, not a hang and not a success.
    expect(await env.act({ kind: "browser.navigate", url: "https://example.com/" })).toMatchObject({ status: "failed" });
    b.ws.close();
  });

  it("a wrong token or code is refused and the socket closed", async () => {
    const { port, pairing } = await start();
    pairing.issue();
    const c = extension(port);
    await c.opened;
    c.send({ type: "hello", v: 1, browser: "firefox", extensionId: EXT, token: "f".repeat(64) });
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "unauthorized" });
    expect(await c.closed).toBe(4001);
    const d = extension(port);
    await d.opened;
    d.send({ type: "hello", v: 1, browser: "firefox", extensionId: EXT, pairCode: "999999" });
    expect(await d.next((m) => m.type === "error")).toMatchObject({ code: "unauthorized" });
  });

  it("a token is bound to the extension the Origin names, not the id the client claims", async () => {
    const { port, pairing } = await start();
    const code = pairing.issue();
    const a = extension(port);
    await a.opened;
    a.send({ type: "hello", v: 1, browser: "chromium", extensionId: EXT, pairCode: code });
    const welcome = await a.next((m) => m.type === "welcome");
    a.ws.close();
    // Another extension replays the stolen token while claiming the paired id.
    const other = extension(port, "chrome-extension://otherextensionidotherextensionid");
    await other.opened;
    other.send({ type: "hello", v: 1, browser: "chromium", extensionId: EXT, token: welcome.token });
    expect(await other.next((m) => m.type === "error")).toMatchObject({ code: "unauthorized" });
    expect(await other.closed).toBe(4001);
  });

  it("a web page origin cannot even open the socket; silence before hello is closed", async () => {
    const { port } = await start();
    const page = extension(port, "https://evil.example");
    await expect(page.opened).rejects.toThrow(/401/);
    const slow = extension(port);
    await slow.opened;
    expect(await slow.next((m) => m.type === "error")).toMatchObject({ code: "timeout" });
  });

  it("without a connected extension commands are NEEDS_CAPABILITY (the managed browser is the fallback)", async () => {
    const { env } = await start();
    expect(await env.act({ kind: "browser.navigate", url: "https://example.com/" })).toMatchObject({ status: "needs_capability" });
    expect(await env.read({ kind: "page" })).toEqual({ open: false });
    expect((await env.capabilities())[0].status).toBe("missing");
  });
});
