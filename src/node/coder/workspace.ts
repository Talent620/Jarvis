// Workspaces a coding agent may work in (M11). Only folders the user added explicitly; the agent
// is started inside one and never pointed anywhere else. Each workspace gets a profile (git state,
// package manager, the repo's own test/lint/typecheck/build commands), a snapshot before a task,
// and a lock: at most one writing task per workspace at a time.

import { existsSync, readFileSync, writeFileSync, realpathSync, statSync, mkdirSync, unlinkSync } from "node:fs";
import * as path from "node:path";
import { execRunner, type Run } from "../linux/runner";
import type { GitSnapshot } from "../../lib/runtime/coder/types";
import { matchWorkspace } from "../../lib/runtime/coder/match";

export interface Workspace {
  id: string;
  name: string;
  root: string;
  addedAt: number;
}

export interface CheckCommand {
  name: "typecheck" | "lint" | "test" | "build" | "secrets";
  cmd: string;
  args: string[];
  /** Where it came from (package.json script, Makefile target, ...): never invented. */
  source: string;
}

export interface WorkspaceProfile {
  workspace: Workspace;
  git: GitSnapshot;
  packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "cargo" | "python" | "make" | "go";
  checks: CheckCommand[];
  kind: string[];
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, " ").trim();
const slugId = (s: string) => norm(s).replace(/\s+/g, "-").slice(0, 40) || "workspace";

export class WorkspaceRegistry {
  private list: Workspace[] = [];
  private locks = new Map<string, string>();

  constructor(private readonly file?: string, private readonly run: Run = execRunner, private readonly now: () => number = () => Date.now()) {
    if (file && existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
        if (Array.isArray(raw)) this.list = raw.filter((w) => w && typeof w.id === "string" && typeof w.root === "string" && typeof w.name === "string") as Workspace[];
      } catch { this.list = []; }
    }
  }

  private save(): void {
    if (!this.file) return;
    try { writeFileSync(this.file, JSON.stringify(this.list, null, 2), { mode: 0o600 }); } catch { /* not fatal */ }
  }

  /** Only an existing directory the user chose; symlinks resolved so the root is what it is. */
  add(root: string, name?: string): Workspace {
    if (!root || !existsSync(root) || !statSync(root).isDirectory()) throw new Error("that folder does not exist");
    const real = realpathSync(root);
    if (real === path.parse(real).root || real === realpathSync(process.env.HOME || "/")) throw new Error("the whole disk or home folder cannot be a workspace");
    const existing = this.list.find((w) => w.root === real);
    if (existing) return existing;
    const base = name?.trim() || path.basename(real);
    let id = slugId(base);
    while (this.list.some((w) => w.id === id)) id = `${id}-2`;
    const w: Workspace = { id, name: base, root: real, addedAt: this.now() };
    this.list.push(w);
    this.save();
    return w;
  }

  remove(id: string): boolean {
    if (this.locks.has(id)) return false;
    const n = this.list.length;
    this.list = this.list.filter((w) => w.id !== id);
    this.save();
    return this.list.length < n;
  }

  all(): Workspace[] {
    return this.list.map((w) => ({ ...w }));
  }

  get(id: string): Workspace | undefined {
    return this.list.find((w) => w.id === id);
  }

  /** "Sterownik Studio", "sterownika studio", "jarvis": the registered workspace the words name. */
  find(words: string): Workspace | undefined {
    return matchWorkspace(this.list, words);
  }

  // ------------------------------------------------------------------------------- locking

  /** One writer per workspace. Returns the holder when it is taken. */
  lock(id: string, taskId: string): { ok: true } | { ok: false; holder: string } {
    const holder = this.locks.get(id);
    if (holder && holder !== taskId) return { ok: false, holder };
    this.locks.set(id, taskId);
    const w = this.get(id);
    if (w) {
      try {
        const dir = path.join(w.root, ".git");
        if (existsSync(dir)) writeFileSync(path.join(dir, "jarvis-coder.lock"), JSON.stringify({ taskId, pid: process.pid, at: this.now() }));
      } catch { /* informational only */ }
    }
    return { ok: true };
  }

  unlock(id: string, taskId: string): void {
    if (this.locks.get(id) !== taskId) return;
    this.locks.delete(id);
    const w = this.get(id);
    if (w) { try { unlinkSync(path.join(w.root, ".git", "jarvis-coder.lock")); } catch { /* gone */ } }
  }

  holder(id: string): string | undefined {
    return this.locks.get(id);
  }

  // ------------------------------------------------------------------------------ git state

  private async git(root: string, args: string[], raw = false): Promise<string | null> {
    const r = await this.run("git", ["-C", root, ...args], { timeoutMs: 15_000 });
    // `status --short` lines start with a space (" M file"): never trim those.
    return r.code === 0 ? (raw ? r.stdout : r.stdout.trim()) : null;
  }

  async snapshot(root: string): Promise<GitSnapshot> {
    const inside = await this.git(root, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") return { isRepo: false, dirty: [] };
    const [branch, head, upstream, remote, status] = await Promise.all([
      this.git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
      this.git(root, ["rev-parse", "HEAD"]),
      this.git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
      this.git(root, ["remote", "get-url", "origin"]),
      this.git(root, ["status", "--short"], true),
    ]);
    return {
      isRepo: true,
      branch: branch ?? undefined,
      head: head ?? undefined,
      upstream: upstream ?? undefined,
      // A remote URL may carry credentials: keep the host and path only.
      remote: remote ? remote.replace(/\/\/[^@/]+@/, "//") : undefined,
      dirty: (status ?? "").split("\n").map((l) => l.trimEnd()).filter(Boolean),
    };
  }

  async profile(id: string): Promise<WorkspaceProfile> {
    const w = this.get(id);
    if (!w) throw new Error("unknown workspace");
    return { workspace: { ...w }, git: await this.snapshot(w.root), ...detectProject(w.root) };
  }
}

/** Package manager and the repo's own check commands, read from its files (never guessed). */
export function detectProject(root: string): { packageManager?: WorkspaceProfile["packageManager"]; checks: CheckCommand[]; kind: string[] } {
  const checks: CheckCommand[] = [];
  const kind: string[] = [];
  let pm: WorkspaceProfile["packageManager"];
  const pkgFile = path.join(root, "package.json");
  if (existsSync(pkgFile)) {
    kind.push("node");
    pm = existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(path.join(root, "yarn.lock")) ? "yarn" : existsSync(path.join(root, "bun.lockb")) ? "bun" : "npm";
    let scripts: Record<string, string> = {};
    try { scripts = (JSON.parse(readFileSync(pkgFile, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}; } catch { scripts = {}; }
    const pick = (name: CheckCommand["name"], candidates: string[]) => {
      const s = candidates.find((c) => typeof scripts[c] === "string" && scripts[c].trim());
      if (s && !/no test specified/.test(scripts[s])) checks.push({ name, cmd: pm!, args: ["run", s], source: `package.json scripts.${s}` });
    };
    pick("typecheck", ["typecheck", "type-check", "tsc", "check-types"]);
    pick("lint", ["lint"]);
    pick("test", ["test", "test:unit"]);
    pick("build", ["build"]);
    pick("secrets", ["scan:secrets", "secrets", "secret-scan"]);
  }
  const make = path.join(root, "Makefile");
  if (existsSync(make)) {
    kind.push("make");
    pm ??= "make";
    const text = readFileSync(make, "utf8");
    for (const t of ["lint", "test", "build"] as const) {
      if (new RegExp(`^${t}\\s*:`, "m").test(text) && !checks.some((c) => c.name === t)) checks.push({ name: t, cmd: "make", args: [t], source: `Makefile target ${t}` });
    }
  }
  if (existsSync(path.join(root, "Cargo.toml"))) {
    kind.push("rust");
    pm ??= "cargo";
    if (!checks.some((c) => c.name === "test")) checks.push({ name: "test", cmd: "cargo", args: ["test"], source: "Cargo.toml" });
    if (!checks.some((c) => c.name === "build")) checks.push({ name: "build", cmd: "cargo", args: ["build"], source: "Cargo.toml" });
  }
  if (existsSync(path.join(root, "pyproject.toml")) || existsSync(path.join(root, "pytest.ini"))) {
    kind.push("python");
    pm ??= "python";
    const py = existsSync(path.join(root, "pyproject.toml")) ? readFileSync(path.join(root, "pyproject.toml"), "utf8") : "";
    if ((existsSync(path.join(root, "pytest.ini")) || /\[tool\.pytest/.test(py)) && !checks.some((c) => c.name === "test")) checks.push({ name: "test", cmd: "python3", args: ["-m", "pytest", "-q"], source: "pytest configuration" });
  }
  if (existsSync(path.join(root, "go.mod"))) {
    kind.push("go");
    pm ??= "go";
    if (!checks.some((c) => c.name === "test")) checks.push({ name: "test", cmd: "go", args: ["test", "./..."], source: "go.mod" });
  }
  const order = ["typecheck", "lint", "test", "build", "secrets"];
  checks.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  return { packageManager: pm, checks, kind };
}

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}
