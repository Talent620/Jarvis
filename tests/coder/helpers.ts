// Test helpers for the coding executor: a throwaway git project with one bug and one red test,
// the fake Codex / Claude CLIs, and scenario files. No network, no model, no paid call.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

export const FAKE_CODEX = path.resolve(__dirname, "../fixtures/coder/fake-codex.mjs");
export const FAKE_CLAUDE = path.resolve(__dirname, "../fixtures/coder/fake-claude.mjs");

export const BUGGY = "module.exports = function add(a, b) { return a - b; };\n";
export const FIXED = "module.exports = function add(a, b) { return a + b; };\n";

/** A git repo: add() is wrong, `npm test` fails until it is fixed. */
export function miniProject(opts: { lint?: boolean; noTests?: boolean; readme?: string } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "jarvis-coder-"));
  const scripts: Record<string, string> = {};
  if (!opts.noTests) scripts.test = "node test.js";
  if (opts.lint) scripts.lint = "node -e \"process.exit(0)\"";
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "mini", version: "1.0.0", scripts }, null, 2));
  writeFileSync(path.join(root, "add.js"), BUGGY);
  writeFileSync(path.join(root, "test.js"), "const add = require('./add');\nif (add(2, 3) !== 5) { console.error('FAIL add(2,3)=' + add(2, 3)); process.exit(1); }\nconsole.log('# pass 1');\nconsole.log('# fail 0');\n");
  if (opts.readme) writeFileSync(path.join(root, "README.md"), opts.readme);
  const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return root;
}

export function scenario(dir: string, s: Record<string, unknown>): string {
  const file = path.join(dir, `scenario-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(s));
  return file;
}

export function scratch(): string {
  const d = mkdtempSync(path.join(tmpdir(), "jarvis-coder-scratch-"));
  mkdirSync(d, { recursive: true });
  return d;
}

export function records(file: string): { args: string[]; prompt?: string; text?: string; cwd: string; envKeys: string[] }[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export const read = (root: string, f: string) => readFileSync(path.join(root, f), "utf8");
