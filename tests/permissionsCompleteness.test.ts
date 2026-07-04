import { describe, it, expect } from "vitest";
import { toolDefs } from "../src/lib/tools";
import { isClassified, riskOf } from "../src/lib/permissions";

// Każde WBUDOWANE narzędzie musi mieć jawną klasyfikację ryzyka (read/write/outbound).
// Brak wpisu => fail-safe outbound (pyta o zgodę) — bezpieczne, ale ukrywa pomyłki:
// narzędzie read/write zaczyna niepotrzebnie pytać. Ten test wymusza świadomą decyzję.
describe("permissions — kompletność klasyfikacji narzędzi", () => {
  it("każde wbudowane narzędzie ma jawną klasyfikację", () => {
    const missing = toolDefs.map((d) => d.name).filter((n) => !isClassified(n));
    expect(missing, `Narzędzia bez klasyfikacji ryzyka (dodaj do RISK w permissions.ts):\n${missing.join("\n")}`).toEqual([]);
  });

  it("klasyfikacja zwraca jedną z trzech wartości", () => {
    for (const d of toolDefs) {
      expect(["read", "write", "outbound"]).toContain(riskOf(d.name));
    }
  });

  it("nieznane narzędzie (plugin/MCP) jest fail-safe outbound", () => {
    expect(riskOf("jakiś_nieznany_tool_xyz")).toBe("outbound");
    expect(isClassified("jakiś_nieznany_tool_xyz")).toBe(false);
  });
});
