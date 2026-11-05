import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createWorkspaceTools } = require("../electron/workspace-tools.cjs");
const { createSkillManager } = require("../electron/skill-manager.cjs");
const { createSkillIsolation } = require("../electron/skill-isolation.cjs");
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

describe("generated tools use the native skill lifecycle", () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "jarvis-generated-manager-")); roots.push(root);
    const manager = createSkillManager({ directory: join(root, "skills"), sandbox: createSkillIsolation() });
    const workspace = createWorkspaceTools({ root: join(root, "workspace"), generatedTool: (request: unknown) => manager.command(request) });
    return { root, manager, workspace };
  }
  const candidate = {
    name: "sum-ledger", description: "Sumowanie jawnej listy wartości bez dostępu do plików i sieci.",
    code: "let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const rows=JSON.parse(raw);console.log(JSON.stringify({total:rows.reduce((n,r)=>n+r.amount,0)}))});",
    input: [{ amount: 4 }, { amount: 5 }], expectedOutput: '{"total":9}',
  };
  it("only quarantines a candidate and cannot self-authorize or claim execution", async () => {
    const { manager, workspace } = fixture();
    const result = await workspace.call("generated_tool", { ...candidate, activate: true, trustedUserAction: true });
    expect(result).toMatchObject({ ok: true, accepted: false, executed: false, staged: true, status: "QUARANTINED" });
    const state = await manager.command({ action: "list" });
    expect(state.policies).toEqual([]);
    expect(state.skills[0]).toMatchObject({ id: result.id, hash: result.hash, codeKind: "executable", license: "LicenseRef-Owner-Generated", state: "QUARANTINED", test: null });
    await expect(manager.command({ action: "run", id: result.id }, { taskId: "too-early" })).rejects.toMatchObject({ code: "SKILL_REVOKED" });
  });
  it("requires an independent expected test output and rejects traversal names", async () => {
    const { manager, workspace } = fixture();
    expect(await workspace.call("generated_tool", { ...candidate, expectedOutput: undefined })).toMatchObject({ ok: false });
    expect(await workspace.call("generated_tool", { ...candidate, name: "../escape" })).toMatchObject({ ok: false });
    expect((await manager.command({ action: "list" })).skills).toEqual([]);
  });
  it.runIf(process.env.JARVIS_TEST_SKILL_SANDBOX === "1")("tests, explicitly activates and reuses generated code in the actual OS sandbox", async () => {
    const { manager, workspace } = fixture();
    const staged = await workspace.call("generated_tool", candidate);
    expect(staged.ok).toBe(true);
    const tested = await manager.command({ action: "test", id: staged.id });
    expect(tested).toMatchObject({ state: "VERIFIED", test: { ok: true, expectedOutputMatched: true, evidence: { hash: staged.hash, backend: "bubblewrap-seccomp-node" } } });
    await expect(manager.command({ action: "activate", id: staged.id })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await manager.command({ action: "policy", source: "jarvis:self", codeKinds: ["executable"], permissions: [], licenses: ["LicenseRef-Owner-Generated"] }, { trustedUserAction: true });
    await manager.command({ action: "activate", id: staged.id });
    const result = await manager.command({ action: "run", id: staged.id, input: [{ amount: 12 }, { amount: -3 }] }, { taskId: "new-ledger" });
    expect(result).toMatchObject({ ok: true, hash: staged.hash, status: "COMPLETED" });
    expect(JSON.parse(result.output)).toEqual({ total: 9 });
    const second = await manager.command({ action: "run", id: staged.id, input: [{ amount: 100 }, { amount: 25 }] }, { taskId: "reuse-ledger" });
    expect(JSON.parse(second.output)).toEqual({ total: 125 });
    await manager.command({ action: "revoke", id: staged.id });
    await expect(manager.command({ action: "run", id: staged.id, input: [] }, { taskId: "revoked-ledger" })).rejects.toMatchObject({ code: "SKILL_REVOKED" });
  }, 10000);
});
