// === Osiągalność ekranu FAQ (naprawa martwego propa) ===
// Audyt: `onFaq` był deklarowany w typie propsów More.tsx i przekazywany z App.tsx, ale
// NIGDY nie był wywoływany w More.tsx (nie ma go w tablicy `items` ani nigdzie w JSX) —
// więc ekran FAQ.tsx (135 linii realnej treści) był całkowicie nieosiągalny z UI, mimo że
// istniał i był renderowany warunkowo w App.tsx. Zamiast dodawać zdublowany kafel (co
// zaprzeczyłoby udokumentowanej, celowej decyzji „Pomoc i FAQ scalone w jedno wejście" —
// patrz centerModel.ts i wpis w CHANGELOG z Czerwca 2026), FAQ jest teraz osiągalne z
// WEWNĄTRZ ekranu Pomoc (Help.tsx) — dokładnie tak, jak sugerował już istniejący,
// nieprawdziwy dotąd komentarz „FAQ jest w środku".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("Help.tsx — prowadzi do pełnego FAQ", () => {
  const src = readFileSync("src/components/Help.tsx", "utf8");
  it("przyjmuje opcjonalny onFaq i renderuje przycisk, który go wywołuje", () => {
    expect(src).toMatch(/onFaq\??:\s*\(\)\s*=>\s*void/);
    expect(src).toMatch(/onClick=\{onFaq\}/);
  });
});

describe("App.tsx — FAQ okablowane przez Help, nie przez martwy prop w More", () => {
  const src = readFileSync("src/App.tsx", "utf8");
  it("Help dostaje realny onFaq (otwiera ekran FAQ)", () => {
    expect(src).toMatch(/<Help[^/]*onFaq=\{\(\)\s*=>\s*setShowFaq\(true\)\}/);
  });
  it("More już nie dostaje martwego propa onFaq", () => {
    const moreBlock = src.slice(src.indexOf("<More"), src.indexOf("<More") + 1200);
    expect(moreBlock).not.toMatch(/onFaq=/);
  });
});

describe("More.tsx — martwy prop onFaq usunięty z typu (nie tylko z App.tsx)", () => {
  const src = readFileSync("src/components/More.tsx", "utf8");
  it("nie deklaruje już onFaq w propsach", () => {
    expect(src).not.toMatch(/onFaq/);
  });
});

describe("FAQ.tsx — treść zostaje (nic nie usuwamy, tylko przywracamy dostęp)", () => {
  it("komponent nadal istnieje i eksportuje domyślnie", async () => {
    const mod = await import("../src/components/FAQ");
    expect(typeof mod.default).toBe("function");
  });
});
