// M11 pure parts: parsers of Codex and Claude output, command classes, test counts, the policy
// guard, redaction, project detection, workspace lookup and the verdict table.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import * as path from "node:path";
import { classifyCommand, parseClaudeLine, parseCodexLine, testCounts } from "../../src/node/coder/parse";
import { agentEnv, commandViolation, pathViolation, redactSecrets } from "../../src/node/coder/guard";
import { WorkspaceRegistry, detectProject } from "../../src/node/coder/workspace";
import { decideVerdict } from "../../src/lib/runtime/coder/verdict";

describe("parsers", () => {
  it("Codex item events and the older msg events", () => {
    expect(parseCodexLine('{"type":"thread.started","thread_id":"t1"}')).toEqual([{ kind: "TASK_STARTED", text: "Codex started", sessionId: "t1" }]);
    expect(parseCodexLine(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "bash -lc 'npx vitest run'", aggregated_output: " Tests  2 failed | 183 passed (185)", exit_code: 1 } })))
      .toEqual([{ kind: "RUNNING_TEST", text: "npx vitest run -> exit 1", command: "npx vitest run", exitCode: 1, tests: { passed: 183, failed: 2 } }]);
    expect(parseCodexLine(JSON.stringify({ type: "item.completed", item: { type: "file_change", changes: [{ path: "src/a.ts", kind: "add" }, { path: "b.ts", kind: "update" }] } })).map((e) => e.file)).toEqual(["src/a.ts", "b.ts"]);
    expect(parseCodexLine('{"type":"turn.failed","error":{"message":"quota"}}')[0]).toMatchObject({ kind: "ERROR", end: "failure" });
    expect(parseCodexLine('{"id":"0","msg":{"type":"exec_command_begin","command":["bash","-lc","git status"]}}')[0]).toMatchObject({ kind: "GIT_OPERATION" });
    expect(parseCodexLine('{"id":"0","msg":{"type":"task_complete","last_agent_message":"done"}}')[0]).toMatchObject({ end: "success", final: "done" });
    for (const junk of ["", "not json", "\u001b[32mcolored\u001b[0m", '{"type":"unknown.thing"}', "[1,2]"]) expect(parseCodexLine(junk)).toEqual([]);
  });

  it("Claude Code stream-json", () => {
    expect(parseClaudeLine('{"type":"system","subtype":"init","session_id":"s1","model":"m1"}')[0]).toMatchObject({ kind: "TASK_STARTED", sessionId: "s1", model: "m1" });
    const tool = parseClaudeLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/r/x.ts" } }, { type: "tool_use", name: "Bash", input: { command: "npm test" } }] } }));
    expect(tool.map((e) => e.kind)).toEqual(["EDITING_FILE", "RUNNING_TEST"]);
    expect(parseClaudeLine('{"type":"result","subtype":"error_max_turns","is_error":true}')[0]).toMatchObject({ kind: "ERROR", end: "failure" });
  });

  it("command classes and test counts of common runners", () => {
    expect(classifyCommand("bash -lc 'rg addSticker src'")).toBe("SEARCHING");
    expect(classifyCommand("sed -n 1,40p src/a.ts")).toBe("READING_FILE");
    expect(classifyCommand("npm run build")).toBe("BUILDING");
    expect(classifyCommand("pytest -q")).toBe("RUNNING_TEST");
    expect(testCounts("Tests:       1 failed, 41 passed, 42 total")).toEqual({ passed: 41, failed: 1 });
    expect(testCounts("===== 3 failed, 10 passed in 1.2s =====")).toEqual({ passed: 10, failed: 3 });
    expect(testCounts("test result: FAILED. 7 passed; 1 failed; 0 ignored")).toEqual({ passed: 7, failed: 1 });
    expect(testCounts("nothing here")).toBeUndefined();
  });
});

describe("guard", () => {
  it("never on its own: force push, reset --hard, clean -f, rewrite, push to main, release, deploy, reading secrets", () => {
    const bad = ["git push -f origin x", "git push --force-with-lease", "git push origin +main", "git reset --hard", "git clean -fdx", "git rebase -i HEAD~3", "git commit --amend -m x", "git checkout -- .", "git branch -D feature", "git push origin main", "npm publish", "gh release create v1", "gh pr merge 7", "vercel --prod", "rm -rf /", "cat .env", "printenv"];
    for (const c of bad) expect(commandViolation(c), c).not.toBeNull();
    for (const c of ["git status", "git diff", "git add add.js", "git commit -m fix", "npm test", "rm build/out.js", "git switch -c jarvis/x"]) expect(commandViolation(c), c).toBeNull();
    expect(commandViolation("git push origin jarvis/t1")).toBe("push without your permission");
    expect(commandViolation("git push origin jarvis/t1", { allowPush: true })).toBeNull();
    expect(commandViolation("git tag v2", { constraints: ["nie rób release"] })).toBe("tagging a release");
    expect(commandViolation("git commit -m x", { constraints: ["nie commituj"] })).toMatch(/commit/);
  });

  it("paths outside the workspace or inside .git", () => {
    expect(pathViolation("src/a.ts", "/r")).toBeNull();
    expect(pathViolation("../x", "/r")).toMatch(/outside/);
    expect(pathViolation("/etc/passwd", "/r")).toMatch(/outside/);
    expect(pathViolation(".git/config", "/r")).toMatch(/\.git/);
  });

  it("redaction keeps SHAs but hides keys, tokens, passwords and URL credentials; env is allow-listed", () => {
    const sha = "4599b203c7340f5a13560c2fe387a9f8a91dfcc0";
    const s = redactSecrets(`HEAD ${sha} key=sk-ant-abcdefghijklmnopqrstu PASSWORD: hunter22 https://user:pw@github.com/x Bearer abcdefghijklmnop123 -----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----`, ["my-known-secret"]);
    expect(s).toContain(sha);
    expect(s).not.toMatch(/sk-ant|hunter22|user:pw|abcdefghijklmnop123|BEGIN RSA/);
    expect(redactSecrets("x my-known-secret y", ["my-known-secret"])).toBe("x [ukryte] y");
    const env = agentEnv("codex", { PATH: "/bin", HOME: "/h", OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "a", GITHUB_TOKEN: "g", AWS_SECRET_ACCESS_KEY: "s" });
    expect(Object.keys(env).sort()).toEqual(["HOME", "NO_COLOR", "OPENAI_API_KEY", "PATH"]);
  });
});

describe("workspaces", () => {
  it("detects the repo's own commands and never invents one", () => {
    const d = mkdtempSync(path.join(tmpdir(), "jarvis-ws-"));
    writeFileSync(path.join(d, "package.json"), JSON.stringify({ scripts: { test: "echo \"Error: no test specified\" && exit 1", lint: "eslint .", "type-check": "tsc", build: "vite build" } }));
    writeFileSync(path.join(d, "pnpm-lock.yaml"), "");
    writeFileSync(path.join(d, "Makefile"), "test:\n\tgo test\n");
    const p = detectProject(d);
    expect(p.packageManager).toBe("pnpm");
    expect(p.checks.map((c) => `${c.name}:${c.cmd} ${c.args.join(" ")}`)).toEqual(["typecheck:pnpm run type-check", "lint:pnpm run lint", "test:make test", "build:pnpm run build"]);
    expect(detectProject(mkdtempSync(path.join(tmpdir(), "jarvis-empty-"))).checks).toEqual([]);
  });

  it("only real folders the user adds; found by Polish name forms; the home folder is refused", () => {
    const reg = new WorkspaceRegistry();
    const a = reg.add(mkdtempSync(path.join(tmpdir(), "sterownik-")), "Sterownik Studio");
    reg.add(mkdtempSync(path.join(tmpdir(), "marta-")), "MARTA");
    expect(reg.find("przeanalizuj Sterownik Studio i napraw naklejki")?.id).toBe(a.id);
    expect(reg.find("w sterowniku studio")?.id).toBe(a.id);
    expect(reg.find("zrób coś w projekcie Marty")?.name).toBe("MARTA");
    expect(reg.find("pogoda na jutro")).toBeUndefined();
    expect(() => reg.add(homedir())).toThrow();
    expect(() => reg.add("/")).toThrow();
    expect(() => reg.add("/definitely/not/here")).toThrow();
    expect(reg.lock(a.id, "t1")).toEqual({ ok: true });
    expect(reg.lock(a.id, "t2")).toEqual({ ok: false, holder: "t1" });
    expect(reg.remove(a.id)).toBe(false); // locked
    reg.unlock(a.id, "t1");
    expect(reg.lock(a.id, "t2")).toEqual({ ok: true });
  });
});

describe("verdict", () => {
  const v = (over: Partial<Parameters<typeof decideVerdict>[0]>) => decideVerdict({ ended: "completed", access: "write", agentSaysDone: true, violations: [], ...over });
  const val = (ok: boolean[], extra = {}) => ({ ran: true, noChecks: ok.length === 0, diffStat: "", changedFiles: ["a"], overlapsUserChanges: [], historyIntact: true, checks: ok.map((o, i) => ({ name: `c${i}`, command: "x", exitCode: o ? 0 : 1, ok: o, durationMs: 1, tail: "" })), ...extra });
  it("CONFIRMED only with all checks passing and history intact", () => {
    expect(v({ validation: val([true, true]) }).truth).toBe("CONFIRMED");
    expect(v({ validation: val([true, false]) })).toMatchObject({ truth: "FAILED", partial: true });
    expect(v({ validation: val([]) }).truth).toBe("ATTEMPTED");
    expect(v({ validation: val([true], { historyIntact: false }) }).truth).toBe("FAILED");
    expect(v({ validation: val([true]), violations: ["force push"] }).truth).toBe("BLOCKED");
    expect(v({ ended: "cancelled", validation: val([]) }).truth).toBe("ATTEMPTED");
    expect(v({ ended: "needs_auth" }).truth).toBe("NEEDS_PERMISSION");
    expect(v({ access: "read", validation: { ...val([]), changedFiles: [] } }).truth).toBe("CONFIRMED");
    expect(v({ access: "read", validation: val([]) }).truth).toBe("FAILED");
  });
});

describe("workspace snapshot", () => {
  it("keeps the leading space of `git status --short` (' M file' is file, not 'ile')", async () => {
    const { miniProject } = await import("./helpers");
    const root = miniProject();
    writeFileSync(path.join(root, "add.js"), "changed\n");
    writeFileSync(path.join(root, "new.txt"), "x\n");
    const snap = await new WorkspaceRegistry().snapshot(root);
    expect(snap.dirty).toEqual([" M add.js", "?? new.txt"]);
    const { statusPath } = await import("../../src/node/coder/validate");
    expect(snap.dirty.map(statusPath)).toEqual(["add.js", "new.txt"]);
  });
});
