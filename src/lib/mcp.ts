// === Warstwa MCP (Faza 2) ===
// Jeden standard podłączania narzędzi. Klient zgodny z MCP (JSON-RPC 2.0 over HTTP):
// initialize → tools/list → tools/call. Odkryte narzędzia rejestrujemy w istniejącym
// `toolDefs` (registerTool), więc model widzi je natywnie, a `runTool` routuje wywołanie do
// właściwego serwera. Allowlista ogranicza źródła; treść i narzędzia MCP pozostają niezaufane.
// niedostępny/serwer spoza allowlisty → pomijany, JARVIS działa dalej.
//
// Decyzja: lekki klient zgodny z protokołem zamiast ciężkiego node-SDK w bundlu PWA
// (browser-compat + rozmiar). Obsługuje JSON HTTP; SSE wymaga innego transportu.

import { registerTool, unregisterTool, type ToolDef } from "./tools";
import { revokeToolScopes } from "./permissions";
import { store } from "./store";
import { desktop } from "./desktop";

export interface McpServerConfig {
  name: string;
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  enabled?: boolean;
  token?: string;
}

export interface LoadedMcpTool {
  toolName: string; // nazwa w toolDefs (mcp_<serwer>_<narzędzie>)
  server: string;
  original: string; // oryginalna nazwa po stronie serwera
}

// Domyślna allowlista zaufanych hostów MCP (rozszerzalna w ustawieniach).
export const DEFAULT_MCP_ALLOWLIST = ["localhost", "127.0.0.1", "mcp.googleapis.com"];

/** Host dozwolony? Dokładny host lub subdomena z allowlisty. Czysta, testowalna. */
export function isAllowedHost(url: string, allowlist: string[]): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowlist.some((h) => {
    const a = h.trim().toLowerCase();
    return !!a && (host === a || host.endsWith(`.${a}`));
  });
}

/** Sanityzuj nazwę narzędzia do dozwolonego wzorca [a-z0-9_]. Czysta. */
export function mcpToolName(server: string, original: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `mcp_${clean(server)}_${clean(original)}`.slice(0, 60);
}

/** Wynik tools/list → ToolDef[] (mapuje inputSchema→input_schema). Czysta, testowalna. */
export function mcpToolsToDefs(result: unknown, server: string): { def: ToolDef; original: string }[] {
  const tools = (result as any)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.slice(0, 100)
    .filter((t) => t && typeof t.name === "string" && t.name.length <= 128
      && (!t.inputSchema || (typeof t.inputSchema === "object" && !Array.isArray(t.inputSchema) && JSON.stringify(t.inputSchema).length <= 32000)))
    .map((t) => ({
      original: t.name as string,
      def: {
        name: mcpToolName(server, t.name),
        description: `[MCP:${server}] ${String(t.description || t.name)}`.slice(0, 1024),
        input_schema: (t.inputSchema && typeof t.inputSchema === "object")
          ? (t.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {}, additionalProperties: true },
      },
    }));
}

/** Sformatuj wynik tools/call MCP do tekstu dla modelu. Czysta. */
export function formatMcpResult(result: unknown): string {
  const content = (result as any)?.content;
  if (Array.isArray(content)) {
    const text = content
      .map((c) => (c?.type === "text" ? c.text : c?.text ?? JSON.stringify(c)))
      .filter(Boolean)
      .join("\n");
    if (text) return (result as any)?.isError ? `Błąd narzędzia MCP: ${text}` : text;
  }
  return typeof result === "string" ? result : JSON.stringify(result ?? {});
}

let rpcId = 0;
const aborted = () => new DOMException("Zatrzymano MCP; rozpoczęty skutek wymaga weryfikacji.", "AbortError");
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted());
  let stop: () => void;
  return Promise.race([promise, new Promise<T>((_, reject) => {
    stop = () => reject(aborted()); signal.addEventListener("abort", stop, { once: true });
  })]).finally(() => signal.removeEventListener("abort", stop));
}
interface Connection {
  config: McpServerConfig;
  controller: AbortController;
  tools: Set<string>;
  session?: string;
}
/** Bounded JSON HTTP transport. SSE endpoints are reported as unsupported, never silently accepted. */
async function rpc(active: Connection, method: string, params: Record<string, unknown>, executionSignal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  for (const signal of [active.controller.signal, executionSignal]) {
    signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) cancel();
  }
  const timeout = setTimeout(cancel, 15000);
  try {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    // A remote MCP server must never receive JARVIS's own BFF application token.
    if (active.config.token) headers.authorization = `Bearer ${active.config.token}`;
    if (active.session) headers["mcp-session-id"] = active.session;
    const notification = method.startsWith("notifications/");
    const requestId = notification ? undefined : ++rpcId;
    const res = await abortable(fetch(active.config.url!, {
      method: "POST", headers, redirect: "error", credentials: "omit", signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", ...(!notification ? { id: requestId } : {}), method, params }),
    }), controller.signal);
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
    if (notification) { await res.body?.cancel(); return undefined; }
    if (/text\/event-stream/i.test(res.headers.get("content-type") || "")) { await res.body?.cancel(); throw new Error("Ten endpoint wymaga transportu SSE; wybierz JSON HTTP lub stdio."); }
    if (Number(res.headers.get("content-length") || 0) > 1024 * 1024) { await res.body?.cancel(); throw new Error("Odpowiedź MCP przekracza 1 MiB."); }
    const reader = res.body?.getReader();
    let dataText = "", size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const chunk = await abortable(reader.read(), controller.signal); if (chunk.done) break;
          size += chunk.value.byteLength; if (size > 1024 * 1024) throw new Error("Odpowiedź MCP przekracza 1 MiB.");
          dataText += decoder.decode(chunk.value, { stream: true });
        }
        dataText += decoder.decode();
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    const data = JSON.parse(dataText || "null");
    if (!data || data.jsonrpc !== "2.0" || data.id !== requestId || data.error) throw new Error("Serwer MCP nie potwierdził poprawnego wyniku dla tego żądania.");
    if (method === "initialize") {
      const session = res.headers.get("mcp-session-id");
      if (session && session.length <= 256 && !/[\r\n]/.test(session)) active.session = session;
    }
    if (controller.signal.aborted) throw aborted();
    return data.result;
  } finally {
    clearTimeout(timeout);
    active.controller.signal.removeEventListener("abort", cancel);
    executionSignal?.removeEventListener("abort", cancel);
  }
}

export class McpManager {
  private loaded: LoadedMcpTool[] = [];
  private connections = new Map<string, Connection>();
  private epoch = 0;

  /** Revoke catalog entries and remembered scopes before closing the owned transport. */
  async revoke(server: string): Promise<void> {
    const active = this.connections.get(server);
    this.connections.delete(server); active?.controller.abort();
    const names = this.loaded.filter(t => t.server === server).map(t => t.toolName);
    for (const name of names) unregisterTool(name);
    revokeToolScopes(names);
    this.loaded = this.loaded.filter(t => t.server !== server);
    if (active?.config.command) await desktop()?.mcpStdioDisconnect?.(server).catch(() => {});
  }

  async stopAll(): Promise<void> {
    this.epoch++;
    await Promise.all([...this.connections.keys()].map(name => this.revoke(name)));
  }

  /** Refreshing configuration revokes stale tools and old permissions, including changed endpoints. */
  async loadAll(servers?: McpServerConfig[], allowlist?: string[]): Promise<LoadedMcpTool[]> {
    const generation = ++this.epoch;
    await Promise.all([...this.connections.keys()].map(name => this.revoke(name)));
    const cfg = servers ?? readServers(), allow = allowlist ?? readAllowlist();
    for (const srv of cfg.slice(0, 30)) {
      if (generation !== this.epoch) break;
      if (srv.enabled === false || !/^[a-z0-9 _.-]{1,60}$/i.test(srv.name) || this.connections.has(srv.name)) continue;
      const bridge = desktop();
      if (srv.command ? !bridge?.mcpStdioConnect || !bridge?.mcpStdioCall : !srv.url || !isAllowedHost(srv.url, allow)) continue;
      const active: Connection = { config: { ...srv }, controller: new AbortController(), tools: new Set() };
      this.connections.set(srv.name, active);
      try {
        let listed: unknown;
        if (srv.command) {
          const connected = await abortable(bridge!.mcpStdioConnect!(srv as unknown as Record<string, unknown>), active.controller.signal);
          if (!connected.ok) throw new Error("Nie udało się połączyć stdio.");
          listed = { tools: connected.tools };
        } else {
          await rpc(active, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "JARVIS", version: "2.1" } });
          await rpc(active, "notifications/initialized", {});
          listed = await rpc(active, "tools/list", {});
        }
        if (generation !== this.epoch || this.connections.get(srv.name) !== active || active.controller.signal.aborted) throw aborted();
        for (const { def, original } of mcpToolsToDefs(listed, srv.name)) {
          try {
            // Server annotations such as readOnlyHint do not grant owner permissions.
            registerTool(def, (input, execution) => this.call(srv, original, input, execution));
            active.tools.add(original);
            this.loaded.push({ toolName: def.name, server: srv.name, original });
          } catch { /* A colliding name must not replace another tool. */ }
        }
      } catch {
        if (this.connections.get(srv.name) === active) await this.revoke(srv.name);
        console.warn(`[mcp] Niepotwierdzone połączenie: ${srv.name}`);
      }
    }
    return this.listLoaded();
  }

  async call(srv: McpServerConfig, name: string, args: unknown, execution: { signal?: AbortSignal } = {}): Promise<string> {
    const active = this.connections.get(srv.name);
    if (!active || active.config.url !== srv.url || active.config.command !== srv.command || !active.tools.has(name)) throw new Error("Narzędzie MCP wycofano lub nie zostało odkryte.");
    if (execution.signal?.aborted || active.controller.signal.aborted) throw aborted();
    if (!args || typeof args !== "object" || Array.isArray(args) || JSON.stringify(args).length > 128000) throw new Error("Niepoprawne argumenty MCP.");
    // IPC cannot carry AbortSignal: close this owned stdio client on cancellation.
    const cancelStdio = () => { if (srv.command) void this.revoke(srv.name); };
    execution.signal?.addEventListener("abort", cancelStdio, { once: true });
    try {
      let result: unknown;
      if (srv.command) {
        const bridge = desktop();
        if (!bridge?.mcpStdioCall) throw new Error("MCP stdio wymaga aplikacji desktopowej.");
        const response = await abortable(bridge.mcpStdioCall(srv.name, name, args as Record<string, unknown>), active.controller.signal);
        if (!response.ok) throw new Error("Serwer MCP nie potwierdził wyniku; rozpoczęty skutek wymaga weryfikacji.");
        result = response.result;
      } else result = await rpc(active, "tools/call", { name, arguments: args }, execution.signal);
      if (execution.signal?.aborted || active.controller.signal.aborted || this.connections.get(srv.name) !== active) throw aborted();
      if ((result as { isError?: boolean })?.isError) throw new Error(formatMcpResult(result).slice(0, 4000));
      return formatMcpResult(result).slice(0, 64000);
    } finally { execution.signal?.removeEventListener("abort", cancelStdio); }
  }

  listLoaded(): LoadedMcpTool[] { return this.loaded.map(t => ({ ...t })); }
}

/** Odczytaj konfigurację serwerów z ustawień (JSON). Bezpieczne na śmieci → []. */
export function readServers(): McpServerConfig[] {
  try {
    const raw = JSON.parse(store.settings.mcpServers || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((s) => s && typeof s.name === "string"
      && (typeof s.url === "string" || typeof s.command === "string"));
  } catch {
    return [];
  }
}

export function readAllowlist(): string[] {
  const extra = (store.settings.mcpAllowlist || "")
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_MCP_ALLOWLIST, ...extra])];
}

export const mcpManager = new McpManager();
