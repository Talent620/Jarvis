// BrowserBridge server (mission M8): a loopback-only WebSocket endpoint that accepts connections
// from extension origins, authenticates them (pairing code once, then a token), and exposes the
// user's current tab as a ComputerEnvironment. Without a connected extension every command is
// NEEDS_CAPABILITY and `browser.bridge` is missing, so the runtime keeps the managed browser.

import { WebSocketServer, type WebSocket } from "ws";
import type {
  ActResult, ClipboardRead, ComputerEnvironment, EnvAction, EnvEvent, PageRead, ReadQuery, ReadResult, SelectionRead,
} from "../../lib/runtime/env/types";
import type { CapabilityState } from "../../lib/runtime/types";
import {
  PROTOCOL_VERSION, isLoopback, originAllowed, parseExtensionMessage, type BridgeMethod, type Pairing, type ServerMessage, type TokenStore,
} from "./protocol";

export interface BridgeServerOptions {
  port?: number;
  tokens: TokenStore;
  pairing: Pairing;
  /** Accept only these extension ids (empty: any extension origin). */
  allowedIds?: string[];
  helloTimeoutMs?: number;
  commandTimeoutMs?: number;
}

interface Peer { ws: WebSocket; browser: string; extensionId: string }

export class BrowserBridgeEnvironment implements ComputerEnvironment {
  readonly id = "browser-bridge";
  private peer: Peer | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(e: EnvEvent) => void>();
  private tab: { tabId: number; url: string; title: string; n: number } | null = null;
  constructor(private readonly commandTimeoutMs = 20_000) {}

  get connected(): boolean {
    return !!this.peer && this.peer.ws.readyState === 1;
  }

  /** Internal: the server hands over an authenticated connection. */
  attach(peer: Peer): void {
    if (this.peer && this.peer.ws !== peer.ws) this.peer.ws.close(4000, "replaced by a newer connection");
    this.peer = peer;
  }

  detach(ws: WebSocket): void {
    if (this.peer?.ws !== ws) return;
    this.peer = null;
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error("bridge disconnected")); this.pending.delete(id); }
    this.emit({ type: "closed" });
  }

  resolve(id: number, ok: boolean, data: unknown, error?: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (ok) p.resolve(data);
    else p.reject(new Error(error ?? "extension error"));
  }

  onTab(tabId: number, url: string, title: string): void {
    if (this.tab && this.tab.tabId === tabId && this.tab.url === url) { this.tab.title = title; return; }
    this.tab = { tabId, url, title, n: (this.tab?.n ?? 0) + 1 };
    this.emit({ type: "navigation", pageId: `tab-${tabId}-${this.tab.n}`, url, title });
  }

  onSelection(tabId: number, text: string): void {
    this.emit({ type: "selection", pageId: `tab-${tabId}-${this.tab?.n ?? 0}`, text });
  }

  private emit(e: EnvEvent): void {
    for (const l of this.listeners) { try { l(e); } catch { /* a listener must not break the bridge */ } }
  }

  private call<T>(method: BridgeMethod, params?: Record<string, unknown>): Promise<T> {
    const peer = this.peer;
    if (!peer || peer.ws.readyState !== 1) return Promise.reject(new Error("bridge not connected"));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no answer from the extension`)); }, this.commandTimeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      const msg: ServerMessage = { type: "cmd", id, method, params };
      peer.ws.send(JSON.stringify(msg));
    });
  }

  async capabilities(): Promise<CapabilityState[]> {
    return [{
      id: "browser.bridge", status: this.connected ? "available" : "missing", provider: this.id, checkedAt: Date.now(),
      detail: this.connected ? `${this.peer!.browser} extension connected` : "install and pair the JARVIS browser extension",
    }];
  }

  async act(action: EnvAction): Promise<ActResult> {
    if (!this.connected) return { status: "needs_capability", error: "browser extension not connected (the managed browser is the fallback)" };
    try {
      switch (action.kind) {
        case "browser.launch":
          return { status: "done", data: { note: "the user's browser is already running" } };
        case "browser.navigate":
          if (!/^https?:\/\//i.test(action.url)) return { status: "blocked", error: "only http and https addresses are allowed" };
          await this.call("tab.navigate", { url: action.url });
          return { status: "done" };
        case "clipboard.copy": {
          const r = await this.call<{ ok?: boolean }>("page.copySelection");
          return r?.ok ? { status: "done" } : { status: "failed", error: "the page refused to copy" };
        }
        default:
          return { status: "needs_capability", error: `${action.kind} is not available through the bridge yet` };
      }
    } catch (e) {
      return { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async read(q: ReadQuery): Promise<ReadResult> {
    if (!this.connected) {
      if (q.kind === "page") return { open: false } satisfies PageRead;
      if (q.kind === "selection") return { text: "", visible: false } satisfies SelectionRead;
      if (q.kind === "clipboard") return { ok: false, error: "bridge not connected" } satisfies ClipboardRead;
    }
    switch (q.kind) {
      case "page": {
        const t = await this.call<{ tabId: number; url: string; title: string } | null>("tab.get");
        if (!t) return { open: false } satisfies PageRead;
        this.onTab(t.tabId, t.url, t.title);
        return { open: true, url: t.url, title: t.title, pageId: `tab-${t.tabId}-${this.tab?.n ?? 0}` } satisfies PageRead;
      }
      case "selection": {
        const r = await this.call<{ text?: string } | null>("page.selection");
        const text = typeof r?.text === "string" ? r.text : "";
        return { text, visible: !!text } satisfies SelectionRead;
      }
      case "clipboard":
        return { ok: false, error: "the bridge does not read the clipboard (use the system clipboard)" } satisfies ClipboardRead;
      case "element":
      case "window":
      case "focused":
        return { found: false };
      case "windows":
        return { windows: [] };
      case "collection":
        return { count: 0, items: [] };
    }
  }

  onEvent(listener: (e: EnvEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async close(): Promise<void> {
    this.peer?.ws.close(1000, "closing");
    this.peer = null;
    this.listeners.clear();
  }
}

export class BridgeServer {
  readonly env: BrowserBridgeEnvironment;
  private wss: WebSocketServer | null = null;
  constructor(private readonly o: BridgeServerOptions) {
    this.env = new BrowserBridgeEnvironment(o.commandTimeoutMs);
  }

  /** Listen on 127.0.0.1 only; resolves with the port. */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: "127.0.0.1", port: this.o.port ?? 0, path: "/bridge", maxPayload: 64 * 1024,
        verifyClient: (info: { origin: string; req: { socket: { remoteAddress?: string } } }) => isLoopback(info.req.socket.remoteAddress) && originAllowed(info.origin, this.o.allowedIds),
      });
      this.wss = wss;
      wss.on("error", reject);
      wss.on("listening", () => resolve((wss.address() as { port: number }).port));
      wss.on("connection", (ws) => this.accept(ws));
    });
  }

  private accept(ws: WebSocket): void {
    let authed = false;
    const send = (m: ServerMessage) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
    const reject = (code: "unauthorized" | "bad_version" | "bad_message" | "timeout", message: string) => { send({ type: "error", code, message }); ws.close(4001, code); };
    const hello = setTimeout(() => { if (!authed) reject("timeout", "no hello"); }, this.o.helloTimeoutMs ?? 5000);
    ws.on("message", (data) => {
      const m = parseExtensionMessage(String(data));
      if (!m) { if (!authed) reject("bad_message", "invalid message"); return; }
      if (!authed) {
        if (m.type !== "hello") return reject("unauthorized", "hello first");
        if (m.v !== PROTOCOL_VERSION) return reject("bad_version", `protocol ${PROTOCOL_VERSION} expected`);
        let token: string | undefined;
        if (m.token && this.o.tokens.verify(m.token, m.extensionId)) {
          authed = true;
        } else if (m.pairCode && this.o.pairing.consume(m.pairCode)) {
          token = this.o.tokens.issue(m.extensionId, m.browser);
          authed = true;
        }
        if (!authed) return reject("unauthorized", "pair the extension with the code shown by JARVIS");
        clearTimeout(hello);
        this.env.attach({ ws, browser: m.browser, extensionId: m.extensionId });
        send({ type: "welcome", v: PROTOCOL_VERSION, token });
        return;
      }
      switch (m.type) {
        case "result": this.env.resolve(m.id, m.ok, m.data, m.error); return;
        case "event":
          if (m.event === "tab") this.env.onTab(m.tabId, m.url, m.title);
          else this.env.onSelection(m.tabId, m.text);
          return;
        case "ping": send({ type: "pong" }); return;
        default: return;
      }
    });
    ws.on("close", () => { clearTimeout(hello); this.env.detach(ws); });
    ws.on("error", () => undefined);
  }

  async close(): Promise<void> {
    await this.env.close();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    this.wss = null;
  }
}
