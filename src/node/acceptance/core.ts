// Local acceptance core (mission M6): arguments, progressive steps, the report, and the publish
// plan. Pure and injectable, so the rules (safe defaults, only reports/ published, only on a
// mission branch) are unit tested; run.ts wires the real browser, runtime and git.

export type Mode = "fixture" | "managed-browser" | "local-desktop";
export type StepStatus = "PASS" | "FAIL" | "SKIP" | "NEEDS_HARDWARE" | "BLOCKED" | "SIMULATED";

export interface AcceptanceArgs {
  mode: Mode;
  /** Real mail only with --send; default is a draft. */
  send: boolean;
  /** Recipient for --send (default: the user's own address from the environment). */
  to?: string;
  publish: boolean;
  runs: number;
  headless?: boolean;
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): AcceptanceArgs {
  const get = (name: string) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
  };
  const mode = (get("mode") ?? "fixture") as Mode;
  if (!["fixture", "managed-browser", "local-desktop"].includes(mode)) throw new Error(`unknown --mode ${mode} (fixture, managed-browser, local-desktop)`);
  const runs = Number(get("runs") ?? "1");
  const headless = get("headless");
  return {
    mode,
    send: get("send") === "true",
    to: get("to") ?? env.JARVIS_ACCEPTANCE_TO,
    publish: get("no-publish") !== "true",
    runs: Number.isInteger(runs) && runs > 0 && runs <= 50 ? runs : 1,
    headless: headless === undefined ? undefined : headless !== "false",
  };
}

export interface StepResult {
  id: string;
  title: string;
  status: StepStatus;
  ms: number;
  evidence?: string;
  error?: string;
  screenshot?: string;
  latency?: Record<string, { count: number; p50: number; p95: number }>;
}

export interface StepSpec {
  id: string;
  title: string;
  /** Steps whose PASS (or SIMULATED) this one needs; otherwise it is skipped. */
  needs?: string[];
  run: () => Promise<Omit<StepResult, "id" | "title" | "ms">>;
}

const OK: StepStatus[] = ["PASS", "SIMULATED"];

/** Run steps in order; a step whose prerequisites did not pass is SKIP, never silently PASS. */
export async function runSteps(steps: StepSpec[], now: () => number = () => Date.now()): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for (const s of steps) {
    const missing = (s.needs ?? []).filter((id) => !OK.includes(out.find((r) => r.id === id)?.status as StepStatus));
    if (missing.length) {
      out.push({ id: s.id, title: s.title, status: "SKIP", ms: 0, evidence: `needs ${missing.join(", ")}` });
      continue;
    }
    const t0 = now();
    try {
      const r = await s.run();
      out.push({ id: s.id, title: s.title, ms: now() - t0, ...r });
    } catch (e) {
      out.push({ id: s.id, title: s.title, status: "FAIL", ms: now() - t0, error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
    }
  }
  return out;
}

export interface Capability {
  id: string;
  status: "available" | "missing" | "needs_hardware" | "blocked";
  detail?: string;
}

export interface AcceptanceReport {
  startedAt: string;
  finishedAt: string;
  mode: Mode;
  args: Omit<AcceptanceArgs, "to"> & { to?: "set" | "unset" };
  host: { platform: string; node: string; branch?: string; commit?: string };
  capabilities: Capability[];
  steps: StepResult[];
  verdict: "PASS" | "FAIL" | "PARTIAL";
}

export function verdictOf(steps: StepResult[]): AcceptanceReport["verdict"] {
  if (steps.some((s) => s.status === "FAIL" || s.status === "BLOCKED")) return "FAIL";
  return steps.every((s) => s.status === "PASS") ? "PASS" : "PARTIAL";
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderMarkdown(r: AcceptanceReport): string {
  const lines = [
    `# JARVIS acceptance: ${r.mode}`,
    "",
    `Verdict: **${r.verdict}**. Started ${r.startedAt}, finished ${r.finishedAt}.`,
    `Host: ${r.host.platform}, node ${r.host.node}${r.host.branch ? `, branch ${r.host.branch}` : ""}${r.host.commit ? ` at ${r.host.commit}` : ""}.`,
    `Options: mail=${r.mode === "fixture" ? "mock Gmail (fixture)" : r.args.send ? "real send (--send)" : "draft, nothing sent"}, runs=${r.args.runs}, publish=${r.args.publish ? "yes" : "no"}.`,
    "",
    "## Steps",
    "",
    "| Step | Status | Time | Evidence |",
    "|---|---|---|---|",
    ...r.steps.map((s) => `| ${esc(s.title)} | ${s.status} | ${s.ms} ms | ${esc(s.error ? `${s.error}${s.screenshot ? ` (screenshot ${s.screenshot})` : ""}` : s.evidence ?? "")} |`),
    "",
    "## Capabilities",
    "",
    "| Capability | Status | Detail |",
    "|---|---|---|",
    ...r.capabilities.map((c) => `| ${c.id} | ${c.status} | ${esc(c.detail ?? "")} |`),
  ];
  const lat = r.steps.filter((s) => s.latency);
  if (lat.length) {
    lines.push("", "## Latency (ms)", "", "| Step | Delta | n | p50 | p95 |", "|---|---|---|---|---|");
    for (const s of lat) for (const [k, v] of Object.entries(s.latency!)) if (v.count) lines.push(`| ${esc(s.title)} | ${k} | ${v.count} | ${v.p50} | ${v.p95} |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** File name stem for a report: reports/acceptance-<time>. */
export const reportStem = (at: Date) => `reports/acceptance-${at.toISOString().replace(/[:.]/g, "-")}`;

export interface PublishPlan {
  publish: boolean;
  reason: string;
  commands: string[][];
}

/**
 * Commit and push only the report files, only on a mission branch (claude/*), never with
 * --no-publish. Paths are given to `git commit --` so nothing else staged is included.
 */
export function publishPlan(args: AcceptanceArgs, branch: string | undefined, files: string[], summary: string): PublishPlan {
  if (!args.publish) return { publish: false, reason: "--no-publish", commands: [] };
  if (!branch || !/^claude\//.test(branch)) return { publish: false, reason: `branch ${branch ?? "unknown"} is not a mission branch (claude/*)`, commands: [] };
  const bad = files.filter((f) => !/^reports\/acceptance-[\w.-]+\.(md|json|png)$/.test(f));
  if (bad.length || !files.length) return { publish: false, reason: `refusing to publish non-report files: ${bad.join(", ") || "none given"}`, commands: [] };
  return {
    publish: true,
    reason: `publishing ${files.length} report file(s) to ${branch}`,
    commands: [
      ["git", "add", "--", ...files],
      ["git", "commit", "-m", `acceptance: ${summary}`, "--", ...files],
      ["git", "push", "-u", "origin", branch],
    ],
  };
}
