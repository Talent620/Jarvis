// Coder acceptance (M13): `npm run jarvis:coder:acceptance -- --mode=fake|local|codex`.
// fake:  the whole path (voice words -> JarvisRuntime -> kernel task -> factory -> CoderHost ->
//        agent CLI -> independent validation) with fake Codex / Claude CLIs. No network, no model.
// local: what this machine has (Codex, Claude Code, Ollama: installed, version, login state) and
//        what JARVIS would run as checks in this repository. No agent is started, nothing is paid.
// codex: one real Codex task on a throwaway mini project in the temp folder (one bug, one red
//        test): "Napraw projekt tak, żeby test przeszedł". Paid by the user's Codex plan; refused
//        in CI. The result must be CONFIRMED by JARVIS's own test run, never by Codex's words.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Kernel } from "../../lib/runtime/kernel";
import { JarvisRuntime } from "../../lib/runtime/lanes/runtime";
import { runFactory } from "../../lib/runtime/coder/factory";
import type { CoderPort } from "../../lib/runtime/coder/port";
import type { ComputerEnvironment } from "../../lib/runtime/env/types";
import { ClaudeBackend, CodexBackend, LocalBackend, type CoderBackend } from "./backends";
import { createCoderHost, type CoderHost } from "./host";
import { WorkspaceRegistry, detectProject } from "./workspace";

export type CoderAcceptanceMode = "fake" | "local" | "codex";
export type CheckStatus = "PASS" | "FAIL" | "NEEDS_HARDWARE" | "NEEDS_PERMISSION" | "SKIP";

export interface AcceptanceCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  ms?: number;
}

export interface CoderAcceptanceReport {
  mode: CoderAcceptanceMode;
  startedAt: string;
  platform: string;
  node: string;
  checks: AcceptanceCheck[];
  verdict: "PASS" | "FAIL" | "PARTIAL";
}

export interface CoderAcceptanceOptions {
  mode: CoderAcceptanceMode;
  /** Repository root (fixtures for fake mode, the repo whose checks `local` lists). */
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  log?: (line: string) => void;
  /** Real Codex task timeout. */
  codexTimeoutMs?: number;
}

const BUGGY = "module.exports = function add(a, b) { return a - b; };\n";
const FIXED = "module.exports = function add(a, b) { return a + b; };\n";

/** A throwaway git project outside the user's repositories: add() is wrong, `npm test` is red. */
export function createMiniProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "jarvis-coder-acceptance-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "jarvis-acceptance-mini", version: "1.0.0", private: true, scripts: { test: "node test.js" } }, null, 2));
  writeFileSync(path.join(root, "add.js"), BUGGY);
  writeFileSync(path.join(root, "test.js"), "const add = require('./add');\nif (add(2, 3) !== 5) { console.error('FAIL add(2,3)=' + add(2, 3)); process.exit(1); }\nconsole.log('# pass 1');\nconsole.log('# fail 0');\n");
  writeFileSync(path.join(root, "README.md"), "# Mini project\n\nOne bug, one test. Run `npm test`.\n");
  const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "jarvis-acceptance@example.invalid");
  git("config", "user.name", "JARVIS acceptance");
  git("add", ".");
  git("commit", "-q", "-m", "mini project with one bug");
  return root;
}

const last = (a: string[]): string => a[a.length - 1] ?? "";
const portOf = (host: CoderHost): CoderPort => ({ call: (req) => host.handle(req) as never, onEvents: (cb) => host.onEvents(cb) });

/** The coding lane needs no screen: an environment that has nothing (never used here). */
const NO_SCREEN: ComputerEnvironment = {
  id: "none",
  capabilities: async () => [],
  observe: async () => ({ status: "failed", error: "no screen in coder acceptance" }) as never,
  act: async () => ({ status: "failed", error: "no screen in coder acceptance" }) as never,
  read: async () => ({ status: "failed", error: "no screen in coder acceptance" }) as never,
  onEvent: () => () => undefined,
} as unknown as ComputerEnvironment;

function world(backends: CoderBackend[], root: string, name: string) {
  const userData = mkdtempSync(path.join(tmpdir(), "jarvis-coder-userdata-"));
  const registry = new WorkspaceRegistry(path.join(userData, "jarvis-workspaces.json"));
  registry.add(root, name);
  const host = createCoderHost({ userDataPath: userData, registry, backends, batchMs: 50 });
  const said: string[] = [];
  const kernel = new Kernel();
  const rt = new JarvisRuntime({ kernel, env: NO_SCREEN, speaker: { say: (t) => { said.push(t); }, cancel: () => undefined }, coder: { port: portOf(host), runTask: runFactory, settings: () => ({ backend: "auto", mode: "normal" }) } });
  const task = () => Object.values(kernel.state.tasks).find((t) => t.kind === "code");
  return { host, rt, kernel, said, task, root };
}

async function timed(name: string, fn: () => Promise<Omit<AcceptanceCheck, "name" | "ms">>, now: () => number): Promise<AcceptanceCheck> {
  const t0 = now();
  try {
    return { name, ...(await fn()), ms: now() - t0 };
  } catch (e) {
    return { name, status: "FAIL", detail: e instanceof Error ? e.message : String(e), ms: now() - t0 };
  }
}

const waitUntil = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

async function fakeChecks(o: CoderAcceptanceOptions, now: () => number): Promise<AcceptanceCheck[]> {
  const fixtures = path.join(o.repoRoot, "tests", "fixtures", "coder");
  const scenario = (s: Record<string, unknown>) => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), "jarvis-coder-scn-")), "scenario.json");
    writeFileSync(f, JSON.stringify(s));
    return f;
  };
  const codex = (s: Record<string, unknown>) => new CodexBackend({ bin: path.join(fixtures, "fake-codex.mjs"), extraEnv: { JARVIS_FAKE_CODER_SCRIPT: scenario(s) }, graceMs: 300 });
  const FIX = [{ type: "reasoning", text: "**Reading the failing test**" }, { type: "write", path: "add.js", content: FIXED }, { type: "cmd", command: "npm test", run: ["node", "test.js"] }, { type: "message", text: "Fixed." }];
  const checks: AcceptanceCheck[] = [];
  const hosts: CoderHost[] = [];
  try {
    checks.push(await timed("fake: Codex detected (version, login)", async () => {
      const p = await codex({}).probe();
      return p.availability === "ready" ? { status: "PASS", detail: `${p.version}, ${p.authDetail}` } : { status: "FAIL", detail: p.availability };
    }, now));

    checks.push(await timed("fake: 'Napraw projekt tak, żeby test przeszedł' -> CONFIRMED by the repo's test", async () => {
      const w = world([codex({ steps: [...FIX.slice(0, 2), { type: "sleep", ms: 400 }, ...FIX.slice(2)] })], createMiniProject(), "Projekt");
      hosts.push(w.host);
      await w.rt.coder!.ready;
      w.rt.onText("Napraw projekt tak, żeby test przeszedł");
      await waitUntil(() => !!w.rt.coder!.store.current()?.changedFiles.length, 10_000);
      const status = w.rt.onText("co teraz robi codex?").say ?? "";
      await w.rt.idle();
      const ok = w.task()?.status === "done" && /^Gotowe i sprawdzone/.test(last(w.said)) && readFileSync(path.join(w.root, "add.js"), "utf8") === FIXED;
      return { status: ok && /^Codex pracuje/.test(status) ? "PASS" : "FAIL", detail: `status answer: «${status.slice(0, 120)}»; end: «${last(w.said)}»` };
    }, now));

    checks.push(await timed("fake: agent says done, test stays red -> never 'gotowe'", async () => {
      const w = world([codex({ steps: [{ type: "message", text: "All tests pass!" }] })], createMiniProject(), "Projekt");
      hosts.push(w.host);
      await w.rt.coder!.ready;
      w.rt.onText("Napraw projekt tak, żeby test przeszedł");
      await w.rt.idle();
      const end = last(w.said);
      return { status: w.task()?.status === "failed" && !/Gotowe/.test(w.said.join(" ")) ? "PASS" : "FAIL", detail: `end: «${end}»` };
    }, now));

    checks.push(await timed("fake: 'stop' kills the agent, no process left", async () => {
      const w = world([codex({ steps: [{ type: "sleep", ms: 30_000 }] })], createMiniProject(), "Projekt");
      hosts.push(w.host);
      await w.rt.coder!.ready;
      w.rt.onText("Napraw projekt tak, żeby test przeszedł");
      await waitUntil(() => !!w.host.executor.history().find((r) => r.pid), 10_000);
      const pid = w.host.executor.history().find((r) => r.pid)!.pid!;
      w.rt.onText("stop");
      await w.rt.idle();
      let alive = true;
      try { process.kill(pid, 0); } catch { alive = false; }
      return { status: !alive && w.task()?.status === "cancelled" ? "PASS" : "FAIL", detail: `pid ${alive ? "still alive" : "gone"}, task ${w.task()?.status}` };
    }, now));

    checks.push(await timed("fake: a force push attempt is stopped (BLOCKED)", async () => {
      const w = world([codex({ steps: [{ type: "cmd", command: "git push --force origin main" }] })], createMiniProject(), "Projekt");
      hosts.push(w.host);
      await w.rt.coder!.ready;
      w.rt.onText("Napraw projekt tak, żeby test przeszedł");
      await w.rt.idle();
      return { status: w.task()?.status === "blocked" ? "PASS" : "FAIL", detail: `end: «${last(w.said)}»` };
    }, now));
  } finally {
    for (const h of hosts) await h.close();
  }
  return checks;
}

async function localChecks(o: CoderAcceptanceOptions, now: () => number): Promise<AcceptanceCheck[]> {
  const checks: AcceptanceCheck[] = [];
  const probes = await Promise.all([new CodexBackend(), new ClaudeBackend(), new LocalBackend()].map((b) => b.probe()));
  for (const p of probes) {
    const status: CheckStatus = p.availability === "ready" ? "PASS" : p.availability === "unknown_auth" ? "PASS" : p.availability === "needs_auth" ? "NEEDS_PERMISSION" : "NEEDS_HARDWARE";
    checks.push({ name: `local: ${p.id} backend`, status, detail: [p.availability, p.version, p.authDetail, p.availability === "unavailable" ? p.detail : undefined].filter(Boolean).join(", ") });
  }
  checks.push(await timed("local: this repository's own checks (what JARVIS would run)", async () => {
    const d = detectProject(o.repoRoot);
    return { status: d.checks.length ? "PASS" : "FAIL", detail: d.checks.map((c) => `${c.name}: ${c.cmd} ${c.args.join(" ")} (${c.source})`).join("; ") };
  }, now));
  checks.push(await timed("local: git snapshot of this repository (read-only)", async () => {
    const snap = await new WorkspaceRegistry().snapshot(o.repoRoot);
    return { status: snap.isRepo ? "PASS" : "FAIL", detail: `branch ${snap.branch}, ${snap.dirty.length} uncommitted file(s)` };
  }, now));
  return checks;
}

async function codexChecks(o: CoderAcceptanceOptions, now: () => number): Promise<AcceptanceCheck[]> {
  const env = o.env ?? process.env;
  if (env.CI) return [{ name: "codex: real task", status: "SKIP", detail: "refused in CI: this mode uses the user's paid Codex plan" }];
  const codex = new CodexBackend();
  const p = await codex.probe();
  if (p.availability === "unavailable") return [{ name: "codex: installed", status: "NEEDS_HARDWARE", detail: p.detail ?? "codex not found (npm i -g @openai/codex)" }];
  if (p.availability === "needs_auth") return [{ name: "codex: logged in", status: "NEEDS_PERMISSION", detail: "run `codex login` first" }];
  const checks: AcceptanceCheck[] = [{ name: "codex: installed and logged in", status: "PASS", detail: `${p.version}, ${p.authDetail}` }];
  const root = createMiniProject();
  const w = world([codex], root, "Projekt");
  try {
    await w.rt.coder!.ready;
    checks.push(await timed("codex: 'Napraw projekt tak, żeby test przeszedł' on a throwaway project", async () => {
      o.log?.(`mini project: ${root}`);
      w.rt.onText("Napraw projekt tak, żeby test przeszedł");
      const t0 = now();
      let status = "";
      const timer = setInterval(() => { const line = w.rt.coder!.statusLine(); if (line && line !== status) { status = line; o.log?.(`  ${line}`); } }, 2000);
      try {
        await Promise.race([w.rt.idle(), new Promise((_, rej) => setTimeout(() => rej(new Error("no result within the time limit")), o.codexTimeoutMs ?? 20 * 60_000))]);
      } finally {
        clearInterval(timer);
      }
      // JARVIS's verdict, and our own independent run of the test on top of it.
      let testOk = false;
      try { execFileSync("node", ["test.js"], { cwd: root, stdio: "ignore" }); testOk = true; } catch { testOk = false; }
      const confirmed = w.task()?.status === "done" && /^Gotowe i sprawdzone/.test(last(w.said));
      return {
        status: confirmed && testOk ? "PASS" : "FAIL",
        detail: `JARVIS: «${last(w.said)}»; own test run: ${testOk ? "PASS" : "FAIL"}; ${Math.round((now() - t0) / 1000)} s; last status: «${status.slice(0, 160)}»`,
      };
    }, now));
  } finally {
    await w.host.close();
  }
  return checks;
}

export async function runCoderAcceptance(o: CoderAcceptanceOptions): Promise<CoderAcceptanceReport> {
  const now = o.now ?? (() => Date.now());
  const startedAt = new Date(now()).toISOString();
  const checks = o.mode === "fake" ? await fakeChecks(o, now) : o.mode === "local" ? await localChecks(o, now) : await codexChecks(o, now);
  const failedAny = checks.some((c) => c.status === "FAIL");
  const allPass = checks.every((c) => c.status === "PASS");
  return { mode: o.mode, startedAt, platform: `${process.platform} ${process.arch}`, node: process.version, checks, verdict: failedAny ? "FAIL" : allPass ? "PASS" : "PARTIAL" };
}

export function renderCoderReport(r: CoderAcceptanceReport): string {
  const rows = r.checks.map((c) => `| ${c.name} | ${c.status} | ${c.ms !== undefined ? `${c.ms} ms` : ""} | ${c.detail.replace(/\|/g, "/").replace(/\n/g, " ")} |`);
  return [
    `# JARVIS coder acceptance (${r.mode})`,
    "",
    `- Started: ${r.startedAt}`,
    `- Platform: ${r.platform}, Node ${r.node}`,
    `- Verdict: **${r.verdict}**`,
    "",
    "| Check | Status | Time | Detail |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
