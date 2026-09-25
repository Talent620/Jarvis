// Independent validation after a coding agent (M11). The agent's word is not evidence: JARVIS runs
// the repository's own commands (found by detectProject, never invented), reads the diff since the
// task started and checks that history was not rewritten. Output is redacted and clipped.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import type { CheckResult, ValidationResult } from "../../lib/runtime/coder/types";
import { execRunner, type Run } from "../linux/runner";
import { agentEnv, redactSecrets, secretEnvValues } from "./guard";
import { testCounts } from "./parse";
import type { CheckCommand } from "./workspace";

export interface ValidateOptions {
  root: string;
  checks: CheckCommand[];
  startHead?: string;
  dirtyBefore: string[];
  /** Content hashes of the files that were dirty before the task (see hashDirty). */
  dirtyHashes?: Record<string, string>;
  run?: Run;
  timeoutMs?: number;
  signal?: AbortSignal;
  onCheck?: (c: CheckResult | { name: string; command: string; started: true }) => void;
  now?: () => number;
}

const tailOf = (s: string, n = 12) => s.split("\n").filter((l) => l.trim()).slice(-n).join("\n");
/** "M src/a.ts", "?? new.ts", "R  old -> new" -> the path. */
export const statusPath = (line: string): string => line.slice(3).split(" -> ").pop()!.trim().replace(/^"|"$/g, "");

/** Content hashes of files that were already dirty, so untouched user changes are not counted. */
export function hashDirty(root: string, dirty: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of dirty.slice(0, 500)) {
    const p = statusPath(line);
    const abs = path.join(root, p);
    try {
      out[p] = !existsSync(abs) ? "deleted" : statSync(abs).isDirectory() ? "dir" : statSync(abs).size > 5_000_000 ? `size:${statSync(abs).size}` : createHash("sha1").update(readFileSync(abs)).digest("hex");
    } catch { out[p] = "unreadable"; }
  }
  return out;
}

export async function gitChanges(root: string, startHead: string | undefined, run: Run = execRunner): Promise<{ files: string[]; stat: string; historyIntact: boolean }> {
  const git = (args: string[]) => run("git", ["-C", root, ...args], { timeoutMs: 20_000 });
  const inside = await git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0) return { files: [], stat: "", historyIntact: true };
  const files = new Set<string>();
  const base = startHead ? [startHead] : [];
  const diff = await git(["diff", "--name-only", ...base]);
  for (const f of diff.stdout.split("\n")) if (f.trim()) files.add(f.trim());
  const untracked = await git(["ls-files", "--others", "--exclude-standard"]);
  for (const f of untracked.stdout.split("\n")) if (f.trim()) files.add(f.trim());
  const stat = (await git(["diff", "--stat", ...base])).stdout.trim().split("\n").slice(-1)[0] ?? "";
  let historyIntact = true;
  if (startHead) historyIntact = (await git(["merge-base", "--is-ancestor", startHead, "HEAD"])).code === 0;
  return { files: [...files].sort(), stat: untracked.stdout.trim() ? `${stat}${stat ? ", " : ""}${untracked.stdout.trim().split("\n").length} new file(s)` : stat, historyIntact };
}

/**
 * What the agent changed since the task started. A file that was dirty before counts only when its
 * content changed during the task (the user's own edits are not the agent's).
 */
export async function agentChanges(o: Pick<ValidateOptions, "root" | "startHead" | "dirtyBefore" | "dirtyHashes">, run: Run = execRunner): Promise<{ files: string[]; overlaps: string[]; stat: string; historyIntact: boolean }> {
  const g = await gitChanges(o.root, o.startHead, run);
  const hashesNow = o.dirtyHashes ? hashDirty(o.root, o.dirtyBefore) : {};
  const touchedBefore = (f: string) => !!o.dirtyHashes && f in o.dirtyHashes;
  const files = g.files.filter((f) => !f.startsWith(".jarvis/") && (!touchedBefore(f) || o.dirtyHashes![f] !== hashesNow[f]));
  return { files, overlaps: files.filter((f) => touchedBefore(f)), stat: g.stat, historyIntact: g.historyIntact };
}

export async function validateWorkspace(o: ValidateOptions): Promise<ValidationResult> {
  const run = o.run ?? execRunner;
  const now = o.now ?? (() => Date.now());
  const secrets = secretEnvValues();
  const checks: CheckResult[] = [];
  for (const c of o.checks) {
    if (o.signal?.aborted) break;
    const command = [c.cmd, ...c.args].join(" ");
    o.onCheck?.({ name: c.name, command, started: true });
    const t0 = now();
    // CI=1 turns off watch modes; the environment carries no secrets.
    const r = await run(c.cmd, c.args, { timeoutMs: o.timeoutMs ?? 15 * 60_000, signal: o.signal, cwd: o.root, env: { ...agentEnv("local"), CI: "1" } });
    const out = `${r.stdout}\n${r.stderr}`;
    const result: CheckResult = {
      name: c.name, command, exitCode: r.code, ok: r.code === 0, durationMs: now() - t0,
      tests: c.name === "test" ? testCounts(out) : undefined,
      tail: redactSecrets(tailOf(out), secrets).slice(0, 2000),
    };
    checks.push(result);
    o.onCheck?.(result);
  }
  const g = await agentChanges(o, run);
  return {
    ran: true,
    checks,
    noChecks: o.checks.length === 0,
    diffStat: g.stat,
    changedFiles: g.files,
    overlapsUserChanges: g.overlaps,
    historyIntact: g.historyIntact,
  };
}
