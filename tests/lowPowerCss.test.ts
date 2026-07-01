// === Strażnik: profil low-power realnie wyłącza ciężkie animacje (lowPowerCss) ===
// performanceProfile.applyPerformanceProfile() dokłada klasę „low-power" na <html> dla słabego
// sprzętu (np. Samsung S9: mała pamięć/mało rdzeni). CSS musi wyłączać TE SAME elementy, które
// realnie się animują — inaczej S9 dostaje ciągłą, kosztowną animację mimo poprawnej detekcji.
// Wcześniej selektor celował w nieistniejące bare klasy (.aurora/.matrix-rain/.boss-bg), więc
// animacja nigdy nie gasła. Test pilnuje, żeby regułą low-power ZAWSZE obejmowała te same
// selektory co działająca reguła prefers-reduced-motion (obie muszą wyłączać to samo).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/index.css", "utf8");

// Wyciągnij selektor bloku reguły po jego pierwszym tokenie (np. "html.low-power" albo
// "@media (prefers-reduced-motion: reduce)") — proste, wystarczające do porównania zestawów.
function ruleBlock(marker: string): string {
  const start = css.indexOf(marker);
  expect(start, `nie znaleziono reguły zaczynającej się od: ${marker}`).toBeGreaterThanOrEqual(0);
  const braceOpen = css.indexOf("{", start);
  const braceClose = css.indexOf("}", braceOpen);
  return css.slice(start, braceClose);
}

describe("low-power CSS — realne elementy, nie martwe klasy", () => {
  it("reguła low-power NIE celuje już w nieistniejące bare klasy (.aurora/.matrix-rain/.boss-bg)", () => {
    const block = ruleBlock("html.low-power body.theme-matrix::before");
    expect(block).not.toMatch(/html\.low-power\s+\.aurora\b/);
    expect(block).not.toMatch(/html\.low-power\s+\.matrix-rain\b/);
    expect(block).not.toMatch(/html\.low-power\s+\.boss-bg\b/);
  });

  it("reguła low-power celuje w te same realne selektory co prefers-reduced-motion (matrix/aurora/bossmode)", () => {
    const lowPower = ruleBlock("html.low-power body.theme-matrix::before");
    const reducedMotion = ruleBlock("body.theme-matrix::before, .bossmode::before");
    for (const sel of ["theme-matrix::before", "bossmode::before", "theme-aurora::before", "theme-aurora::after"]) {
      expect(lowPower).toContain(sel);
      expect(reducedMotion).toContain(sel);
    }
  });

  it("reguła low-power realnie wyłącza wyświetlanie i animację (nie tylko jedno z nich)", () => {
    const block = ruleBlock("html.low-power body.theme-matrix::before");
    expect(block).toMatch(/display:\s*none\s*!important/);
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });
});
