// === Kontrola regresji: prawdziwe bramki Sales OS ===
// Główny ESLint IGNORUJE katalog sales-os, więc zmiana tam nie może przejść tylko dlatego, że główne
// bramki jej nie widzą. Ten test pilnuje, że istnieje realny gate sales-os (prisma generate +
// typecheck + lint + build) oraz workflow CI uruchamiany na zmianach sales-os.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("sales-os — realny gate (nie tylko ignorowany katalog)", () => {
  it("package.json ma skrypt `gates` obejmujący generate + typecheck + lint + build", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "sales-os/package.json"), "utf8")) as { scripts?: Record<string, string> };
    const gates = pkg.scripts?.gates || "";
    expect(gates).toMatch(/prisma generate/);
    expect(gates).toMatch(/typecheck/);
    expect(gates).toMatch(/lint/);
    expect(gates).toMatch(/next build/);
    expect(pkg.scripts?.typecheck).toMatch(/tsc --noEmit/);
  });

  it("workflow CI sales-os istnieje, wyzwala się na zmianach sales-os i uruchamia `npm run gates`", () => {
    const wf = readFileSync(resolve(root, ".github/workflows/sales-os-gates.yml"), "utf8");
    expect(wf).toMatch(/sales-os\/\*\*/);      // wyzwalacz na ścieżce sales-os
    expect(wf).toMatch(/npm run gates/);       // uruchamia realny gate
    expect(wf).toMatch(/working-directory:\s*sales-os/);
  });
});
