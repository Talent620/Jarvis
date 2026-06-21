import { describe, it, expect, afterEach } from "vitest";
import { registerSkill, unregisterSkill, listSkills, hasSkill } from "../src/lib/skills";
import { toolDefs, registerTool, unregisterTool } from "../src/lib/tools";

const has = (name: string) => toolDefs.some((d) => d.name === name);
const mkTool = (name: string) => ({ def: { name, description: name, input_schema: { type: "object", properties: {} } }, run: () => `ran ${name}` });

afterEach(() => { unregisterSkill("crypto"); unregisterSkill("other"); });

describe("skills — modułowe rozszerzanie bez ruszania rdzenia", () => {
  it("registerSkill dokłada narzędzia widoczne dla modelu (toolDefs) + listSkills", () => {
    expect(has("skill_a")).toBe(false);
    registerSkill({ id: "crypto", title: "Krypto", version: "1.0", tools: [mkTool("skill_a"), mkTool("skill_b")] });
    expect(has("skill_a")).toBe(true);
    expect(has("skill_b")).toBe(true);
    expect(hasSkill("crypto")).toBe(true);
    expect(listSkills().find((s) => s.id === "crypto")?.toolCount).toBe(2);
  });

  it("disposer / unregisterSkill usuwa wszystkie narzędzia umiejętności", () => {
    const off = registerSkill({ id: "crypto", title: "Krypto", tools: [mkTool("skill_a")] });
    expect(has("skill_a")).toBe(true);
    off();
    expect(has("skill_a")).toBe(false);
    expect(hasSkill("crypto")).toBe(false);
  });

  it("idempotentne: ponowna rejestracja tego samego id nie dubluje (hot-reload-safe)", () => {
    registerSkill({ id: "crypto", title: "Krypto v1", tools: [mkTool("skill_a")] });
    registerSkill({ id: "crypto", title: "Krypto v2", tools: [mkTool("skill_a"), mkTool("skill_b")] });
    expect(toolDefs.filter((d) => d.name === "skill_a")).toHaveLength(1); // brak duplikatu
    expect(has("skill_b")).toBe(true);
    expect(listSkills().find((s) => s.id === "crypto")?.title).toBe("Krypto v2");
  });

  it("OCHRONA RDZENIA: skill nie nadpisze ani nie usunie wbudowanego narzędzia", () => {
    // „add_task" to narzędzie wbudowane — kolizja musi rzucić, nawet z replace.
    expect(() => registerTool({ name: "add_task", description: "hijack", input_schema: { type: "object", properties: {} } }, () => "x", { replace: true }))
      .toThrow(/wbudowane|już istnieje/);
    expect(unregisterTool("add_task")).toBe(false); // nie da się usunąć rdzenia
    expect(has("add_task")).toBe(true);
  });

  it("walidacja: pusty manifest rzuca", () => {
    expect(() => registerSkill({ id: "", title: "x", tools: [mkTool("z")] })).toThrow();
    expect(() => registerSkill({ id: "other", title: "x", tools: [] })).toThrow();
  });
});
