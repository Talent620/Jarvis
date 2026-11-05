import { describe, expect, it } from "vitest";
import { toolDefs, type ToolDef } from "../src/lib/tools";
import { systemMcpDefinitions } from "../src/lib/systemMcp";
import { selectToolsForIntent, toolsetSize } from "../src/lib/toolSelector";
import { ollamaToolSchemaBudget } from "../src/lib/providers/ollama";

const defs: ToolDef[] = [...toolDefs, ...systemMcpDefinitions.map((d) => ({ name: d.name, description: d.description, input_schema: d.input }))];

describe("retrieval composition — unit layer, not real LLM generalization", () => {
  it("retrieves needed tools for 12 unseen combinations within the same schema budget", () => {
    const cases: [string, string[]][] = [
      ["Odczytaj plik z kosztami i podlicz wartości", ["system_files_read", "calculate"]],
      ["Zapisz zestawienie finansowe w katalogu projektu", ["system_files_write", "finance_summary"]],
      ["Znajdź wiadomość mailową i dodaj zadanie do odpowiedzi", ["gmail_search", "add_task"]],
      ["Pokaż spotkania i przypomnij o dokumentach", ["gcal_list", "add_reminder"]],
      ["Zapamiętaj preferencję i dopisz notatkę", ["remember_fact", "add_note"]],
      ["Odczytaj stronę, a potem zapisz jej treść w pliku", ["system_browser_read_public", "system_files_write"]],
      ["Na komputerze przełącz okno i wklej tekst w edytorze", ["desktop_active_window", "desktop_hotkey"]],
      ["Pokaż prognozę pogody i listę zakupów", ["get_weather", "list_shopping"]],
      ["Sprawdź klienta i dopisz przypomnienie", ["lead_dossier", "add_reminder"]],
      ["Sprawdź finanse oraz termin spotkania", ["finance_summary", "gcal_list"]],
      ["Otwórz plik w edytorze i sprawdź aktywne okno", ["desktop_open", "desktop_active_window"]],
      ["Znajdź mail od księgowej i odczytaj plik z fakturą", ["gmail_search", "system_files_read"]],
    ];
    for (const [query, required] of cases) {
      const selected = selectToolsForIntent(query, defs);
      expect(selected.map((d) => d.name), query).toEqual(expect.arrayContaining(required));
      expect(toolsetSize(selected).chars, query).toBeLessThanOrEqual(10000);
      expect(selected.length, query).toBeLessThanOrEqual(24);
    }
  });
  it("does not let a flood of plugins or huge schemas defeat the budget", () => {
    const plugins = Array.from({ length: 100 }, (_, i) => ({ name: `plugin_${i}`, description: "Odczytaj plik", input_schema: { payload: "x".repeat(20000) } }));
    const selected = selectToolsForIntent("Odczytaj plik", [...plugins, ...defs]);
    expect(selected.some((d) => d.name.startsWith("plugin_"))).toBe(false);
    expect(selected.some((d) => d.name === "system_files_read")).toBe(true);
    expect(toolsetSize(selected).chars).toBeLessThanOrEqual(10000);
  });
  it("reduces the schema allowance when the actual system/current turn grows", () => {
    expect(ollamaToolSchemaBudget("s", "u", 4096)).toBeGreaterThan(ollamaToolSchemaBudget("s".repeat(3000), "u", 4096));
    expect(ollamaToolSchemaBudget("s".repeat(20000), "u", 4096)).toBe(0);
  });
});
