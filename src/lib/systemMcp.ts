import { registerTool } from "./tools";
import { desktop } from "./desktop";

export interface SystemToolResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

type SystemTool = "status" | "files_list" | "files_read" | "files_write" | "git" | "terminal" | "docker" | "database" | "http" | "browser_open" | "generated_tool";

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const arr = (description: string) => ({ type: "array", items: { type: "string" }, description });

const definitions: { tool: SystemTool; name: string; description: string; input: Record<string, unknown> }[] = [
  { tool: "status", name: "system_workspace_status", description: "Sprawdź dostępne lokalne narzędzia i zabezpieczenia środowiska JARVIS.", input: schema({}) },
  { tool: "files_list", name: "system_files_list", description: "Wyświetl pliki i katalogi wewnątrz bezpiecznego katalogu roboczego.", input: schema({ path: str("Ścieżka względna") }) },
  { tool: "files_read", name: "system_files_read", description: "Odczytaj plik tekstowy z katalogu roboczego (maks. 2 MB).", input: schema({ path: str("Ścieżka względna pliku") }, ["path"]) },
  { tool: "files_write", name: "system_files_write", description: "Zapisz plik w katalogu roboczym. Przed nadpisaniem tworzona jest kopia.", input: schema({ path: str("Ścieżka względna pliku"), content: str("Pełna treść") }, ["path", "content"]) },
  { tool: "git", name: "system_git", description: "Uruchom bezpieczne polecenie Git w katalogu roboczym.", input: schema({ args: arr("Argumenty Git, np. ['status','--short']"), cwd: str("Opcjonalny podkatalog") }, ["args"]) },
  { tool: "terminal", name: "system_terminal", description: "Uruchom polecenie z ograniczonej allowlisty bez powłoki systemowej.", input: schema({ command: str("git, node, npm, npx, docker, sqlite3 lub psql"), args: arr("Argumenty"), cwd: str("Opcjonalny podkatalog") }, ["command"]) },
  { tool: "docker", name: "system_docker", description: "Sprawdź Docker lub uruchom bezpieczne polecenie Docker.", input: schema({ args: arr("Argumenty Docker"), cwd: str("Opcjonalny podkatalog") }) },
  { tool: "database", name: "system_database_read", description: "Wykonaj odczytowe SELECT/PRAGMA/EXPLAIN/WITH w SQLite lub PostgreSQL.", input: schema({ engine: str("sqlite albo postgres"), database: str("Względna ścieżka SQLite"), connection: str("Connection string PostgreSQL"), query: str("Zapytanie tylko do odczytu") }, ["engine", "query"]) },
  { tool: "http", name: "system_http_request", description: "Wywołaj API HTTP/HTTPS z limitem czasu i rozmiaru odpowiedzi.", input: schema({ url: str("Adres HTTP/HTTPS"), method: str("Metoda HTTP"), body: str("Opcjonalne body") }, ["url"]) },
  { tool: "browser_open", name: "system_browser_open", description: "Otwórz bezpieczny adres HTTP/HTTPS w domyślnej przeglądarce użytkownika.", input: schema({ url: str("Adres HTTP/HTTPS") }, ["url"]) },
  { tool: "generated_tool", name: "system_generate_tool", description: "Utwórz narzędzie Node w tools/generated; zachowaj je wyłącznie po kontroli składni i self-teście.", input: schema({ name: str("Bezpieczna nazwa"), code: str("Kod CommonJS obsługujący --self-test") }, ["name", "code"]) },
];

let initialized = false;

export function initSystemMcp(): number {
  if (initialized || !desktop()?.agentTool) return 0;
  initialized = true;
  for (const def of definitions) {
    registerTool(
      { name: def.name, description: `[SYSTEM MCP] ${def.description}`, input_schema: def.input },
      async (input) => {
        const result = await desktop()!.agentTool!(def.tool, input as Record<string, unknown>);
        return JSON.stringify(result);
      },
    );
  }
  return definitions.length;
}

export const systemMcpDefinitions = definitions;
