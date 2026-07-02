// === Adapter węzła „device" — most między Sztafetą a protokołem MCP ===
// Wykonuje krok na urządzeniu mówiącym MCP (emulator LUB realny ESP32/RPi — ten sam
// kontrakt tools/call), a następnie ROBI ODCZYT ZWROTNY (read_state), żeby drabina prawdy
// mogła dojść do CONFIRMED tylko po faktycznej zmianie. Ten sam adapter działa z fizycznym
// sprzętem — zmienia się wyłącznie transport (in-proces emulator vs HTTP JSON-RPC z mcp.ts).
import type { McpCallResult } from "./deviceEmulator";
import type { NodeExecResult } from "./missionRelay";
import type { MissionStep } from "./types";

/** Minimalny kontrakt urządzenia MCP potrzebny sztafecie (emulator go spełnia). */
export interface McpDevice {
  call(name: string, args?: Record<string, unknown>): Promise<McpCallResult>;
}

function textOf(r: McpCallResult): string {
  return (r.content || []).map((c) => c.text).filter(Boolean).join("\n");
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Zbuduj NodeExecutor dla urządzenia: akcja (capability) → odczyt zwrotny (read_state).
 * `capability` mapuje się 1:1 na narzędzie MCP; po akcji czytamy klucze z `expect`.
 */
export function deviceExecutor(dev: McpDevice): (step: MissionStep) => Promise<NodeExecResult> {
  return async (step: MissionStep): Promise<NodeExecResult> => {
    const act = await dev.call(step.capability, step.args || {});
    if (act.isError) {
      return { actuated: false, actuateError: textOf(act) || "błąd urządzenia" };
    }
    // Odczyt zwrotny — pobierz faktyczny stan, żeby potwierdzić skutek (nie ufamy ACK).
    let readback: Record<string, unknown> | undefined;
    if (step.expect) {
      const keys = Object.keys(step.expect);
      const rb = await dev.call("read_state", keys.length === 1 ? { key: keys[0] } : {});
      if (!rb.isError) readback = parseJson(textOf(rb));
    }
    return { actuated: true, readback };
  };
}
