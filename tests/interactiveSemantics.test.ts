// === Strażnik semantyki interakcji (interactiveSemantics) ===
// Na krytycznych ekranach klikalne elementy muszą być SEMANTYCZNE (button / role), nie „gołe" span/div.
// Chroni dostępność (klawiatura, czytnik ekranu) i dotyk na S9. Backdrop modala (.sheet/.panel) jest OK.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Ekrany, które użytkownik dotyka najczęściej — tu pilnujemy semantyki bezwzględnie.
const CRITICAL = [
  "src/components/Composer.tsx",
  "src/components/SalesDashboard.tsx",
  "src/components/Journal.tsx",
  "src/components/TaskHub.tsx",
  "src/components/Projects.tsx",
];

const read = (p: string) => readFileSync(p, "utf8");
// Otwierające tagi span/div z onClick (jedna linia). Prosty skaner źródła — bez /u, S9-safe.
const openTags = (src: string, tag: string): string[] =>
  src.split("\n").filter((l) => new RegExp(`<${tag}\\b[^>]*\\bonClick`).test(l));

describe("interactiveSemantics — brak gołych klikalnych span na krytycznych ekranach", () => {
  for (const file of CRITICAL) {
    it(`${file}: żaden <span onClick> (użyj <button>)`, () => {
      expect(openTags(read(file), "span")).toEqual([]);
    });

    it(`${file}: każdy <div onClick> to backdrop (.sheet/.panel) albo ma role=`, () => {
      const offenders = openTags(read(file), "div").filter(
        (l) => !/className="(sheet|panel)"|className=\{`(sheet|panel)/.test(l) && !/\brole=/.test(l),
      );
      expect(offenders).toEqual([]);
    });
  }
});
