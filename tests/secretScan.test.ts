import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const scanner = resolve("scripts/secret-scan.mjs");
const directories: string[] = [];
function fixture(initialize = true) {
  const cwd = mkdtempSync(join(tmpdir(), "jarvis-scan-"));
  directories.push(cwd);
  if (initialize) {
    const git = spawnSync("git", ["init", "--quiet"], { cwd });
    expect(git.status).toBe(0);
  }
  return cwd;
}
function scan(cwd: string) {
  return spawnSync(process.execPath, [scanner, "--all"], { cwd, encoding: "utf8" });
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("release secret scan", () => {
  it("fails closed when no repository can be inspected", () => {
    const result = scan(fixture(false));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("kontrola nie została wykonana");
  });
  it("rejects a credential without echoing its value into CI evidence", () => {
    const cwd = fixture();
    const synthetic = "sk-proj-" + "X".repeat(45);
    writeFileSync(join(cwd, "config.txt"), synthetic);
    expect(spawnSync("git", ["add", "config.txt"], { cwd }).status).toBe(0);
    const result = scan(cwd);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("config.txt:1");
    expect(result.stderr + result.stdout).not.toContain(synthetic);
  });
  it("rejects tracked signing material and accepts a clean tree", () => {
    const cwd = fixture();
    expect(scan(cwd).status).toBe(0);
    writeFileSync(join(cwd, "signing.jks"), "synthetic test data");
    expect(spawnSync("git", ["add", "signing.jks"], { cwd }).status).toBe(0);
    const result = scan(cwd);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("signing.jks");
  });
});
