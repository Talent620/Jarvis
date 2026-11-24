import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("AUTOCORE ops: agent-lock (bare repo) + guardian-daemon", () => {
  it("agent-lock atomowo zajmuje, blokuje duplikat i zwalnia blokadę na zdalnym bare repo", () => {
    const base = mkdtempSync(join(tmpdir(), "jarvis-lock-"));
    try {
      const bare = join(base, "remote.git");
      const work = join(base, "work");
      execFileSync("git", ["init", "--bare", bare], { stdio: "ignore" });
      execFileSync("git", ["init", work], { stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: work });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: work });
      writeFileSync(join(work, "a.txt"), "1\n");
      execFileSync("git", ["add", "a.txt"], { cwd: work });
      execFileSync("git", ["commit", "-m", "init"], { cwd: work, stdio: "ignore" });
      execFileSync("git", ["remote", "add", "origin", bare], { cwd: work });

      const script = join(process.cwd(), "scripts/agent-lock.mjs");
      const claim1 = execFileSync("node", [script, "claim", "task-x", "--agent", "antigravity"], { cwd: work, encoding: "utf8" });
      expect(claim1).toContain("Zajęto blokadę 'task-x'");

      const list = execFileSync("node", [script, "list"], { cwd: work, encoding: "utf8" });
      expect(list).toContain("task-x");

      let secondExit = 0;
      try {
        execFileSync("node", [script, "claim", "task-x", "--agent", "codex"], { cwd: work, stdio: "pipe" });
      } catch (e) {
        secondExit = (e as { status?: number }).status ?? 1;
      }
      expect(secondExit).toBe(2);

      const rel = execFileSync("node", [script, "release", "task-x"], { cwd: work, encoding: "utf8" });
      expect(rel).toContain("Zwolniono blokadę 'task-x'");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("guardian-daemon --once generuje deterministyczny raport bez LLM", () => {
    const out = execFileSync("node", ["scripts/guardian-daemon.mjs", "--once"], { encoding: "utf8" });
    const rep = JSON.parse(out.trim());
    expect(rep.secretScanOk).toBe(true);
    expect(typeof rep.head).toBe("string");
    expect(rep.llmDiagnosis).toBeUndefined();
  });
});
