// === Warstwa MCP (Faza 2) ===
// Jeden standard podłączania narzędzi. Klient zgodny z MCP (JSON-RPC 2.0 over HTTP):
// initialize → tools/list → tools/call. Odkryte narzędzia rejestrujemy w istniejącym
// `toolDefs` (registerTool), więc model widzi je natywnie, a `runTool` routuje wywołanie do
// właściwego serwera. ALLOWLISTA hostów chroni przed tool poisoning. Wszystko graceful:
// niedostępny/serwer spoza allowlisty → pomijany, JARVIS działa dalej.
//
// Decyzja: lekki klient zgodny z protokołem zamiast ciężkiego node-SDK w bundlu PWA
// (browser-compat + rozmiar). Kontrakt MCP zachowany.

import { fetchTimeout, appTokenHeader } from "./http";
import { registerTool, type ToolDef } from "./tools";
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
    host = new URL(url).hostname.toLowerCase();
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
  return tools
    .filter((t) => t && typeof t.name === "string")
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

async function rpc(url: string, method: string, params: Record<string, unknown>, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", ...appTokenHeader() };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  }, 15000);
  if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  if (data && (data as any).error) throw new Error((data as any).error?.message || "MCP error");
  return (data as any)?.result;
}

export class McpManager {
  private loaded: LoadedMcpTool[] = [];
  private registered = new Set<string>();

  /** Połącz, pobierz i zarejestruj narzędzia ze wszystkich włączonych, dozwolonych serwerów. */
  async loadAll(servers?: McpServerConfig[], allowlist?: string[]): Promise<LoadedMcpTool[]> {
    const cfg = servers ?? readServers();
    const allow = allowlist ?? readAllowlist();
    for (const srv of cfg) {
      if (srv.enabled === false) continue;
      if (srv.command) {
        const bridge = desktop();
        if (!bridge?.mcpStdioConnect || !bridge?.mcpStdioCall) {
          console.warn(`[mcp] stdio wymaga aplikacji desktopowej: ${srv.name}`);
          continue;
        }
        try {
          const connected = await bridge.mcpStdioConnect(srv as unknown as Record<string, unknown>);
          if (!connected.ok) throw new Error(connected.error || "Nie udało się połączyć.");
          for (const { def, original } of mcpToolsToDefs({ tools: connected.tools }, srv.name)) {
            if (this.registered.has(def.name)) continue;
            try {
              registerTool(def, async (input) => {
                const response = await bridge.mcpStdioCall!(srv.name, original, input as Record<string, unknown>);
                if (!response.ok) return `Narzędzie MCP „${original}" niedostępne (${response.error || "błąd"}).`;
                return formatMcpResult(response.result);
              });
              this.registered.add(def.name);
              this.loaded.push({ toolName: def.name, server: srv.name, original });
            } catch {
              /* nazwa zajęta / nieprawidłowa — pomiń to narzędzie */
            }
          }
        } catch (e) {
          console.warn(`[mcp] nie udało się uruchomić ${srv.name}:`, e instanceof Error ? e.message : e);
        }
        continue;
      }
      if (!srv.url) continue;
      if (!isAllowedHost(srv.url, allow)) {
        console.warn(`[mcp] serwer poza allowlistą — pomijam: ${srv.url}`);
        continue;
      }
      try {
        await rpc(srv.url, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "JARVIS", version: "2.0" } }, srv.token);
        const list = await rpc(srv.url, "tools/list", {}, srv.token);
        for (const { def, original } of mcpToolsToDefs(list, srv.name)) {
          if (this.registered.has(def.name)) continue;
          try {
            registerTool(def, (input) => this.call(srv, original, input));
            this.registered.add(def.name);
            this.loaded.push({ toolName: def.name, server: srv.name, original });
          } catch {
            /* nazwa zajęta / nieprawidłowa — pomiń to narzędzie */
          }
        }
      } catch (e) {
        console.warn(`[mcp] nie udało się załadować ${srv.name}:`, e instanceof Error ? e.message : e);
        /* graceful — serwer niedostępny, lecimy dalej */
      }
    }
    return this.loaded;
  }

  /** Wykonaj narzędzie MCP (wołane przez runTool dla zarejestrowanych nazw). */
  async call(srv: McpServerConfig, name: string, args: unknown): Promise<string> {
    if (!srv.url) return `Narzędzie MCP „${name}" nie ma adresu HTTP.`;
    try {
      const result = await rpc(srv.url, "tools/call", { name, arguments: args ?? {} }, srv.token);
      return formatMcpResult(result);
    } catch (e) {
      return `Narzędzie MCP „${name}" niedostępne (${e instanceof Error ? e.message : e}).`;
    }
  }

  listLoaded(): LoadedMcpTool[] {
    return [...this.loaded];
  }
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
