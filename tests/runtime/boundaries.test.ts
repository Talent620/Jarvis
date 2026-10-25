import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The renderer bundle must never pull Node-only code (Playwright, src/node). Those modules run
// in the Electron main process or in tests/CLI only.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node" || n === "generated" ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("runtime boundaries", () => {
  it("no renderer module imports playwright or src/node", () => {
    const offenders = files("src").filter((f) => /from\s+["'](playwright(-core)?|[./]+\/node\/[^"']+)["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the shared runtime has no Node built-in imports", () => {
    const offenders = files("src/lib/runtime").filter((f) => /from\s+["']node:/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
