// === Kontrola regresji konfiguracji ESLint ===
// Wygenerowane artefakty buildu (dist, dist-studio) MUSZĄ zostać w globalnych `ignores` ESLinta.
// Gdyby ktoś je stamtąd usunął, bramka `npx eslint` znów zapełniłaby się tysiącami błędów z
// zminifikowanych bundli (self is not defined itd.), a `eslint src tests` NIE jest równoważne
// bramce `npx eslint`. Ten test importuje PRAWDZIWĄ konfigurację i pilnuje, że artefakty są ignorowane.
import { describe, it, expect } from "vitest";
import eslintConfig from "../eslint.config.js";

// tseslint.config(...) zwraca płaską tablicę obiektów konfiguracji; wpis `{ ignores: [...] }`
// przechodzi przez nią jako osobny element. Zbieramy wszystkie globalne ignores.
function globalIgnores(cfg: unknown): string[] {
  const arr = Array.isArray(cfg) ? cfg : [cfg];
  return arr.flatMap((c) => {
    const ig = (c as { ignores?: unknown })?.ignores;
    return Array.isArray(ig) ? ig.filter((x): x is string => typeof x === "string") : [];
  });
}

describe("eslint.config — generowane artefakty pozostają ignorowane", () => {
  const ignores = globalIgnores(eslintConfig);

  it("dist i dist-studio są w globalnych ignores (bramka npx eslint nie łapie bundli)", () => {
    expect(ignores).toContain("dist");
    expect(ignores).toContain("dist-studio");
  });

  it("konfiguracja w ogóle deklaruje globalne ignores (element {ignores})", () => {
    expect(ignores.length).toBeGreaterThan(0);
  });
});
