// === Końcowy strażnik jakości UI (uiQualityGuard) ===
// Konsoliduje sieć bezpieczeństwa: żadnej „martwej pustki" (pusty Suspense) w całej apce oraz
// obecność pozostałych strażników (semantyka, dotyk, migracja modali, granica ekranu). Dzięki temu
// jakość UI nie „rozjedzie się" po cichu. Nie duplikuje szczegółowych reguł — spina je w jeden test.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const COMP = "src/components";
const files = readdirSync(COMP).filter((f) => f.endsWith(".tsx"));

describe("uiQualityGuard — brak martwej pustki (pusty Suspense)", () => {
  it("nigdzie nie ma fallback={null} (każdy Suspense pokazuje szkielet)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (/fallback=\{null\}/.test(readFileSync(`${COMP}/${f}`, "utf8"))) offenders.push(f);
    }
    // ScreenBoundary już używa ScreenSkeleton; nowe Suspense też muszą.
    expect(offenders).toEqual([]);
  });

  it("każdy <Suspense ma fallback (nie renderuje pustki)", () => {
    const offenders: string[] = [];
    for (const f of files.concat(["../App.tsx"])) {
      const p = f.startsWith("..") ? `src/${f.slice(3)}` : `${COMP}/${f}`;
      if (!existsSync(p)) continue;
      const src = readFileSync(p, "utf8");
      // Suspense użyty bez atrybutu fallback w tym samym znaczniku.
      const m = src.match(/<Suspense(?![^>]*fallback)[^>]*>/);
      if (m) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

describe("uiQualityGuard — sieć strażników jest na miejscu", () => {
  it("istnieją pozostałe strażniki (semantyka, dotyk, modale, granica ekranu, przepływ)", () => {
    for (const t of [
      "tests/interactiveSemantics.test.ts",
      "tests/touchTargets.test.ts",
      "tests/modalMigrationGuard.test.ts",
      "tests/screenBoundary.test.ts",
      "tests/clientFlowE2E.test.ts",
    ]) {
      expect(existsSync(t)).toBe(true);
    }
  });
});
