// === Strażnik obszarów dotyku (touchTargets) ===
// Przyciski akcji nie mogą mieć zbyt małego celu dotyku na S9. Zabraniamy lokalnych minHeight 32/40
// (poniżej 44 px) — po migracji wszystkie takie przyciski mają >=44 px.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "src/components";
const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));

describe("touchTargets — brak przycisków poniżej 44 px (minHeight 32/40)", () => {
  for (const f of files) {
    it(`${f}: brak minHeight: 32 / 40`, () => {
      const src = readFileSync(`${DIR}/${f}`, "utf8");
      const bad = src.split("\n").filter((l) => /minHeight:\s*(32|40)\b/.test(l));
      expect(bad).toEqual([]);
    });
  }
});
