// === Emulator urządzenia jako PRAWDZIWY drugi koniec protokołu MCP ===
// To NIE jest atrapa zwracająca „ok". Emulator utrzymuje realny stan i wystawia
// dokładnie ten kontrakt, który wystawiłby serwer MCP na ESP32/RPi:
//   call(name, arguments) → { content: [{ type:"text", text }], isError? }
// Kluczowe: „read_state" RAPORTUJE faktyczny stan po akcji (odczyt zwrotny), więc
// drabina prawdy może dojść do CONFIRMED wyłącznie po realnej zmianie — tak samo,
// jak weryfikowałaby fizyczne urządzenie. Fizyczny sprzęt = ten sam adapter (mcp.ts),
// inny transport. Emulator jest SYMULACJĄ sprzętu i tak się przedstawia.
//
// Kontrakt zgodny z formatMcpResult() z ../mcp.ts (content[].text).

export interface McpCallResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Konfiguracja emulatora: jakie „piny/rejestry" ma urządzenie i limity. */
export interface EmulatorConfig {
  /** Nazwa (do traceId/audytu). */
  name?: string;
  /** Początkowy stan rejestrów (np. { led: "off", temp: 21 }). */
  initial?: Record<string, unknown>;
}

/**
 * Emulator urządzenia mówiący protokołem MCP. Obsługiwane narzędzia:
 *  - set_state { key, value }  → ustawia rejestr, zwraca ACK (bez „potwierdzam skutek");
 *  - read_state { key? }       → ODCZYT ZWROTNY faktycznego stanu (dowód dla CONFIRMED);
 *  - pulse { key, ms }         → chwilowa zmiana (np. mignięcie diodą) z auto-powrotem stanu.
 * Można wstrzyknąć awarię (`fail`) i offline (`online=false`) do testów „wyrwanej wtyczki".
 */
export class DeviceEmulator {
  private state: Record<string, unknown>;
  readonly name: string;
  online = true;
  /** Gdy ustawione, następne wywołanie zwróci błąd (symulacja usterki). */
  private failNext = false;
  /** Licznik realnych zmian stanu — do testów idempotencji („wyślij-raz"). */
  actuations = 0;

  constructor(cfg: EmulatorConfig = {}) {
    this.name = cfg.name || "emu";
    this.state = { ...(cfg.initial || {}) };
  }

  /** Wymuś błąd następnego wywołania (usterka transientna). */
  injectFailure(): void {
    this.failNext = true;
  }

  setOnline(v: boolean): void {
    this.online = v;
  }

  /** Podgląd stanu (dla testów) — kopia, nie referencja. */
  snapshot(): Record<string, unknown> {
    return { ...this.state };
  }

  private ok(text: string): McpCallResult {
    return { content: [{ type: "text", text }] };
  }
  private err(text: string): McpCallResult {
    return { content: [{ type: "text", text }], isError: true };
  }

  /** Kontrakt MCP tools/call. Zwraca kształt zgodny z formatMcpResult(). */
  async call(name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
    if (!this.online) return this.err("urządzenie offline");
    if (this.failNext) {
      this.failNext = false;
      return this.err("usterka transientna urządzenia");
    }
    switch (name) {
      case "set_state": {
        const key = String(args.key ?? "");
        if (!key) return this.err("brak klucza");
        this.state[key] = args.value;
        this.actuations += 1;
        // ACK — NIE twierdzimy „skutek potwierdzony"; potwierdza dopiero read_state.
        return this.ok(JSON.stringify({ ack: true, key }));
      }
      case "pulse": {
        const key = String(args.key ?? "");
        if (!key) return this.err("brak klucza");
        this.state[key] = args.value ?? "on";
        this.actuations += 1;
        return this.ok(JSON.stringify({ ack: true, key, pulsed: true }));
      }
      case "read_state": {
        // Odczyt zwrotny — faktyczny stan urządzenia (dowód dla drabiny prawdy).
        const key = args.key != null ? String(args.key) : "";
        if (key) return this.ok(JSON.stringify({ [key]: this.state[key] }));
        return this.ok(JSON.stringify({ ...this.state }));
      }
      default:
        return this.err(`nieznane narzędzie: ${name}`);
    }
  }
}
