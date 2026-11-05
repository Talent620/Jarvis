import { desktop } from "./desktop";
import type { ToolDef, Executor } from "./tools";

const text = { type: "string" };
const definitions: [string, string, string, Record<string, unknown>, string[]][] = [
  ["workspace_status", "status", "Sprawdź katalog roboczy i dostępność lokalnych narzędzi na Linuksie/Windows. Zacznij od tego przed pracą na plikach.", {}, []],
  ["workspace_list", "files_list", "Lista plików i katalogów w workspace. Ścieżki względne wobec katalogu roboczego.", { path: text }, []],
  ["workspace_read", "files_read", "Odczytaj plik tekstowy w workspace (do 2 MB).", { path: text }, ["path"]],
  ["workspace_write", "files_write", "Zapisz plik w workspace. Istniejący plik jest kopiowany do lokalnego backupu.", { path: text, content: text }, ["path", "content"]],
  ["workspace_terminal", "terminal", "Uruchom git, node, npm, npx, docker, sqlite3 lub psql w workspace. Argumenty jako tablica; bez składni powłoki. Sprawdź kod wyjścia i output.", { command: text, args: { type: "array", items: text }, cwd: text }, ["command", "args"]],
];

export const workspaceAgentTools: { def: ToolDef; run: Executor }[] = definitions.map(([name, operation, description, properties, required]) => ({
  def: { name, description, input_schema: { type: "object", properties, required, additionalProperties: false } },
  run: async (input: Record<string, unknown>) => {
    const bridge = desktop();
    if (!bridge?.agentTool) return JSON.stringify({ ok: false, error: "Otwórz aplikację desktopową JARVIS, aby pracować na lokalnych plikach i terminalu." });
    return JSON.stringify(await bridge.agentTool(operation, input));
  },
}));
