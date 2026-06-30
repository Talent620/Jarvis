import { describe, it, expect } from "vitest";
import { selectToolsForIntent, matchedGroups, toolsetSize } from "../src/lib/toolSelector";
import { toolDefs } from "../src/lib/tools";

const names = (defs: typeof toolDefs) => defs.map((d) => d.name);

describe("toolSelector — dobór narzędzi wg intencji", () => {
  it("zapytanie finansowe → finance + rdzeń, bez narzędzi telefonu/desktopu", () => {
    const sel = selectToolsForIntent("ile zarobiłem, pokaż zysk i marżę", toolDefs);
    const n = names(sel);
    expect(n).toContain("finance_summary");
    expect(n).toContain("open_screen"); // rdzeń zawsze
    expect(n).not.toContain("desktop_power");
    expect(n).not.toContain("android_tap");
    expect(sel.length).toBeLessThan(toolDefs.length);
  });

  it("zapytanie sprzedażowe → narzędzia leadów/CRM", () => {
    const n = names(selectToolsForIntent("znajdź leady i przygotuj teczkę klienta", toolDefs));
    expect(n).toContain("find_leads");
    expect(n).toContain("lead_dossier");
    expect(n).not.toContain("get_markets");
  });

  it("multi-domena: leady + zadanie → obie grupy obecne", () => {
    const n = names(selectToolsForIntent("znajdź leady i dodaj zadanie na jutro", toolDefs));
    expect(n).toContain("find_leads");
    expect(n).toContain("add_task");
  });

  it("niejasna intencja → PEŁNY zestaw (bezpieczny fallback)", () => {
    const sel = selectToolsForIntent("opowiedz mi dowcip", toolDefs);
    expect(sel.length).toBe(toolDefs.length);
  });

  it("puste zapytanie → pełny zestaw", () => {
    expect(selectToolsForIntent("", toolDefs).length).toBe(toolDefs.length);
  });

  it("narzędzia dynamiczne (nieznane/pluginy) zawsze przechodzą", () => {
    const fake = [...toolDefs, { name: "plugin_xyz", description: "x", input_schema: { type: "object", properties: {} } } as any];
    const n = names(selectToolsForIntent("ile zarobiłem", fake));
    expect(n).toContain("plugin_xyz");
  });

  it("matchedGroups wykrywa właściwe domeny", () => {
    expect(matchedGroups("pogoda na jutro")).toContain("info");
    expect(matchedGroups("zapamiętaj że lubię kawę")).toContain("memory");
    expect(matchedGroups("xyz")).toEqual([]);
  });

  it("toolsetSize liczy i mierzy długość", () => {
    const full = toolsetSize(toolDefs);
    const fin = toolsetSize(selectToolsForIntent("zysk i marża", toolDefs));
    expect(full.count).toBeGreaterThan(fin.count);
    expect(fin.chars).toBeLessThan(full.chars);
  });
});
