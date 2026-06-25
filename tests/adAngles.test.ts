import { describe, it, expect } from "vitest";
import { AD_ANGLES, adAngleGuide } from "../src/lib/adAngles";
import { adUserPrompt } from "../src/lib/adStudio";

describe("AD_ANGLES — kąty emocjonalne reklamy", () => {
  it("ma kluczowe kąty, unikalne id i niepuste wytyczne", () => {
    const ids = AD_ANGLES.map((a) => a.id);
    for (const must of ["pain", "fomo", "social", "saving"]) expect(ids).toContain(must);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of AD_ANGLES) { expect(a.label.length).toBeGreaterThan(0); expect(a.guide.length).toBeGreaterThan(10); }
  });
  it("adAngleGuide zwraca wytyczną lub pusty string", () => {
    expect(adAngleGuide("fomo")).toMatch(/pilność|traci/i);
    expect(adAngleGuide("nieistnieje")).toBe("");
  });
});

describe("adUserPrompt — kąt dokleja się do promptu reklamy", () => {
  it("z kątem: dokleja wytyczną; bez kąta: prompt bez tej linii", () => {
    const withAngle = adUserPrompt({ platform: "google", product: "kurs", angle: adAngleGuide("fomo") });
    expect(withAngle).toMatch(/Kąt przekazu/);
    const without = adUserPrompt({ platform: "google", product: "kurs" });
    expect(without).not.toMatch(/Kąt przekazu/);
  });
});
