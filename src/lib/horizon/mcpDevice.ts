// === Transport HTTP-MCP dla węzła „device" Sztafety Misji ===
// Fizyczny ESP32/RPi (lub dowolny serwer MCP po HTTP) staje się węzłem sztafety
// TYM SAMYM adapterem co emulator: spełnia kontrakt McpDevice (tools/call →
// { content:[{type:"text",text}], isError? }), więc deviceExecutor + drabina prawdy
// działają bez zmian — zmienia się wyłącznie transport.
// Bezpieczeństwo: allowlista hostów (fail-closed, jak w mcp.ts) — urządzenie spoza
// listy NIGDY nie dostaje wywołania. Timeout ogranicza wiszące połączenia.
// UWAGA UCZCIWOŚCI: ten moduł testujemy przeciwko stubowi HTTP — NIE twierdzimy,
// że przetestowano fizyczny sprzęt.
import { fetchTimeout, appTokenHeader } from "../http";
import { isAllowedHost, readAllowlist } from "../mcp";
import type { McpCallResult } from "./deviceEmulator";
import type { McpDevice } from "./deviceNode";

export interface McpDeviceConfig {
  /** Adres serwera MCP urządzenia, np. http://192.168.1.50/mcp (LAN). */
  url: string;
  /** Opcjonalny token Bearer (parowanie urządzenia). */
  token?: string;
  /** Allowlista hostów; domyślnie wspólna z mcp.ts (ustawienia + localhost). */
  allowlist?: string[];
  /** Timeout wywołania w ms (domyślnie 10 s — urządzenia bywają wolne). */
  timeoutMs?: number;
}

let rpcId = 0;

/** Błąd jako wynik MCP (spójny kształt — sztafeta zobaczy FAILED, nie wyjątek). */
function errResult(text: string): McpCallResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Zbuduj McpDevice nad HTTP JSON-RPC 2.0 (kontrakt tools/call jak w mcp.ts).
 * Fail-closed: host spoza allowlisty → każde wywołanie zwraca isError bez sieci.
 */
export function httpMcpDevice(cfg: McpDeviceConfig): McpDevice {
  const allow = cfg.allowlist ?? readAllowlist();
  const timeout = cfg.timeoutMs && cfg.timeoutMs > 0 ? cfg.timeoutMs : 10000;

  return {
    async call(name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
      if (!isAllowedHost(cfg.url, allow)) {
        return errResult(`urządzenie poza allowlistą hostów: ${cfg.url}`);
      }
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
        ...appTokenHeader(),
      };
      if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
      try {
        const res = await fetchTimeout(
          cfg.url,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: ++rpcId,
              method: "tools/call",
              params: { name, arguments: args },
            }),
          },
          timeout,
        );
        if (!res.ok) return errResult(`urządzenie odpowiedziało HTTP ${res.status}`);
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string }; result?: McpCallResult }
          | null;
        if (!data) return errResult("nieczytelna odpowiedź urządzenia");
        if (data.error) return errResult(data.error.message || "błąd MCP urządzenia");
        const result = data.result;
        // Waliduj kształt kontraktu — śmieci z sieci nie mogą udawać odczytu zwrotnego.
        if (!result || !Array.isArray(result.content)) {
          return errResult("odpowiedź urządzenia bez treści (zły kształt MCP)");
        }
        return { content: result.content, isError: result.isError };
      } catch (e) {
        return errResult(
          `urządzenie niedostępne (${e instanceof Error ? e.message : String(e)})`,
        );
      }
    },
  };
}
