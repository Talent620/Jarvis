import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createWorkspaceTools } = require("../electron/workspace-tools.cjs");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("wygenerowane narzędzie bez izolacji", () => {
  it("nie uruchamia ani nie zapisuje kodu i nie nadpisuje istniejącego pliku", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-generated-test-")); roots.push(root);
    const runtime = createWorkspaceTools({ root });
    const marker = join(root, "executed.txt");
    const accepted = join(root, "tools", "generated", "check.cjs");
    const candidate = join(root, "tools", "generated", "check.candidate.cjs");
    writeFileSync(accepted, "zachowaj dotychczasowe narzędzie");
    writeFileSync(candidate, "zachowaj wcześniejszego kandydata");
    const code = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'uruchomiono');`;
    const result = await runtime.call("generated_tool", { name: "check", code });
    expect(result).toMatchObject({ ok: false, blocked: true, accepted: false });
    expect(result.error).toMatch(/izolowanego środowiska/);
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(accepted, "utf8")).toBe("zachowaj dotychczasowe narzędzie");
    expect(readFileSync(candidate, "utf8")).toBe("zachowaj wcześniejszego kandydata");
    const log = readFileSync(join(root, ".jarvis", "logs", "actions.jsonl"), "utf8");
    expect(log).not.toContain(code);
  });
  it("status nie obiecuje izolacji ani generowania narzędzi", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-generated-status-")); roots.push(root);
    const result = await createWorkspaceTools({ root }).call("status", {});
    expect(result.safety.generatedToolSandbox).toBe(false);
    expect(result.safety.processSandbox).toBe(false);
    expect(result.safety.workspaceBoundaryScope).toBe("file adapters only");
    expect(result.capabilities).not.toContain("generated-tools");
  });
});
