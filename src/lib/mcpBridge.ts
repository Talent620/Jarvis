// === Mostek narzędzi MCP zgodny z electron/mcp-stdio.cjs ===
// Zapewnia ten sam kontrakt walidacji i wywołań co proces główny Electrona (allowlista komend,
// blokada znaków sterujących, limity argumentów/env, connect → tools/list → call → close),
// działając zarówno przez IPC `window.jarvisDesktop`, jak i z wstrzykiwalnym transportem (testy/CLI).
import { desktop } from "./desktop";
import { formatMcpResult, mcpToolsToDefs, type McpServerConfig } from "./mcp";
import { registerTool, type ToolDef } from "./tools";

export const STDIO_ALLOWED_COMMANDS = new Set([
  "node",
  "npx",
  "python",
  "python3",
  "uvx",
  "docker",
  "bun",
  "deno",
]);

export interface StdioMcpTransport {
  connect(config: Record<string, unknown>): Promise<{ ok: boolean; tools?: unknown[]; error?: string }>;
  call(server: string, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }>;
  close(server: string): Promise<{ ok: boolean; error?: string }>;
}

export interface ValidatedStdioConfig {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/** Pure: nazwa bazowa polecenia (identyczna reguła jak electron/mcp-stdio.cjs). */
export function stdioCommandBase(command: string): string {
  const parts = String(command || "").trim().split(/[\\/]/);
  return (parts[parts.length - 1] || "").toLowerCase().replace(/\.(exe|cmd|bat)$/i, "");
}

/** Pure: walidacja konfiguracji serwera stdio przed wysłaniem do electron/mcp-stdio.cjs. */
export function validateStdioConfig(raw: McpServerConfig): ValidatedStdioConfig {
  const name = String(raw.name || "").trim().slice(0, 60);
  const command = String(raw.command || "").trim();
  if (!name || !/^[a-z0-9 _.-]+$/i.test(name)) {
    throw new Error("Nazwa serwera MCP jest nieprawidłowa.");
  }
  const base = stdioCommandBase(command);
  if (!STDIO_ALLOWED_COMMANDS.has(base)) {
    throw new Error(`Program „${base || command}” nie znajduje się na allowliście MCP.`);
  }
  const args = Array.isArray(raw.args) ? raw.args.map(String).slice(0, 80) : [];
  if (args.some((arg) => arg.length > 4096 || /[\r\n\0]/.test(arg))) {
    throw new Error("Argument MCP jest zbyt długi lub zawiera niedozwolone znaki sterujące.");
  }
  const env: Record<string, string> = {};
  if (raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)) {
    for (const [k, v] of Object.entries(raw.env).slice(0, 50)) {
      if (/^[A-Z_][A-Z0-9_]*$/i.test(k) && String(v).length <= 10_000) {
        env[k] = String(v);
      }
    }
  }
  return { name, command, args, cwd: String(raw.cwd || ".").trim() || ".", env };
}

/** Domyślny transport IPC podpinany do electron/mcp-stdio.cjs przez preload.cjs. */
export function createDesktopStdioTransport(): StdioMcpTransport | null {
  const bridge = desktop();
  if (!bridge?.mcpStdioConnect || !bridge?.mcpStdioCall) return null;
  return {
    connect: (cfg) => bridge.mcpStdioConnect!(cfg),
    call: (server, tool, args) => bridge.mcpStdioCall!(server, tool, args),
    close: (server) => (bridge.mcpStdioDisconnect ? bridge.mcpStdioDisconnect(server) : Promise.resolve({ ok: true })),
  };
}

/**
 * Mostek narzędzi MCP (stdio): waliduje konfigurację, łączy z serwerem przez electron/mcp-stdio.cjs,
 * rejestruje odkryte narzędzia w `toolDefs` i routuje wywołania z bezpiecznym formatowaniem wyniku.
 */
export class McpStdioBridge {
  private readonly connected = new Map<string, ToolDef[]>();

  constructor(private readonly transport: StdioMcpTransport | null = createDesktopStdioTransport()) {}

  async connectServer(
    rawConfig: McpServerConfig,
    opts: { register?: boolean } = {},
  ): Promise<{ ok: boolean; tools: ToolDef[]; error?: string }> {
    if (!this.transport) {
      return { ok: false, tools: [], error: "Mostek MCP stdio wymaga środowiska desktopowego (Electron)." };
    }
    let validated: ValidatedStdioConfig;
    try {
      validated = validateStdioConfig(rawConfig);
    } catch (e) {
      return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
    }
    const res = await this.transport.connect(validated as unknown as Record<string, unknown>);
    if (!res.ok) {
      return { ok: false, tools: [], error: res.error || "Nie udało się połączyć z serwerem MCP." };
    }
    const mapped = mcpToolsToDefs({ tools: res.tools || [] }, validated.name);
    const defs = mapped.map((m) => m.def);
    this.connected.set(validated.name, defs);

    if (opts.register !== false) {
      for (const { def, original } of mapped) {
        try {
          registerTool(def, (input) => this.callTool(validated.name, original, (input || {}) as Record<string, unknown>));
        } catch {
          /* narzędzie już zarejestrowane */
        }
      }
    }
    return { ok: true, tools: defs };
  }

  async callTool(server: string, originalTool: string, args: Record<string, unknown>): Promise<string> {
    if (!this.transport) return "Mostek MCP stdio jest niedostępny.";
    const res = await this.transport.call(server, originalTool, args);
    if (!res.ok) return `Narzędzie MCP „${originalTool}” zwróciło błąd: ${res.error || "nieznany błąd"}.`;
    return formatMcpResult(res.result);
  }

  async disconnect(server: string): Promise<boolean> {
    this.connected.delete(server);
    if (!this.transport) return true;
    const r = await this.transport.close(server);
    return !!r.ok;
  }

  listConnectedServers(): string[] {
    return [...this.connected.keys()];
  }
}
