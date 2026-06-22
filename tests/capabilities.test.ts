import { describe, it, expect } from "vitest";
import { capabilitiesDigest, selfCheckDigest, jarvisBriefing } from "../src/lib/capabilities";

describe("capabilitiesDigest — wiedza Szefa o całym JARVISIE", () => {
  it("wymienia kluczowe obszary programu", () => {
    const d = capabilitiesDigest();
    for (const k of ["Czat AI", "Głos", "Sprzedaż", "Zakupy", "Pamięć", "Recall", "Działania"]) {
      expect(d).toContain(k);
    }
  });
  it("jest zwięzły (mieści się w budżecie promptu)", () => {
    expect(capabilitiesDigest().length).toBeLessThan(3000);
  });
});

describe("selfCheckDigest / jarvisBriefing — uczciwa samoocena", () => {
  it("zwraca tekst i nie rzuca (nawet bez pełnej konfiguracji)", () => {
    const s = selfCheckDigest();
    expect(typeof s).toBe("string");
  });
  it("briefing łączy wiedzę i stan", () => {
    const b = jarvisBriefing();
    expect(b).toContain("WIEDZA O JARVISIE");
  });
});
