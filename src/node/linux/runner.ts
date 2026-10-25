// Command runner for the Linux adapters. Always argv arrays (no shell), a timeout, and an
// injected implementation in tests (contract tests replay tool outputs without a desktop).

import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Written to stdin, then stdin is closed. */
  input?: string;
  timeoutMs?: number;
  /** The tool forks and keeps running (xclip, wl-copy): resolve when the parent exits. */
  background?: boolean;
  /** "stop": the child is killed at once (typing must not go on after the user said stop). */
  signal?: AbortSignal;
  /** Working directory (coding checks run inside the workspace). */
  cwd?: string;
  /** Replaces the environment (coding agents and checks get an allow-listed one). */
  env?: NodeJS.ProcessEnv;
}

export type Run = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

export const execRunner: Run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    let out = "";
    let err = "";
    let settled = false;
    const done = (r: RunResult) => { if (!settled) { settled = true; clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort); resolve(r); } };
    if (opts.signal?.aborted) { resolve({ code: 130, stdout: "", stderr: "aborted" }); return; }
    const child = spawn(cmd, args, {
      stdio: [opts.input !== undefined ? "pipe" : "ignore", opts.background ? "ignore" : "pipe", opts.background ? "ignore" : "pipe"],
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      // Own process group on POSIX so a timeout or stop kills the whole tree (no orphans).
      detached: process.platform !== "win32",
    });
    const killTree = () => {
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    };
    const timer = setTimeout(() => { killTree(); done({ code: 124, stdout: out, stderr: `${err}timeout` }); }, opts.timeoutMs ?? 5000);
    function onAbort() { killTree(); done({ code: 130, stdout: out, stderr: "aborted" }); }
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const cap = (s: string) => (s.length > 400_000 ? s.slice(-400_000) : s);
    child.stdout?.on("data", (d) => { out = cap(out + String(d)); });
    child.stderr?.on("data", (d) => { err = cap(err + String(d)); });
    child.on("error", (e) => done({ code: 127, stdout: "", stderr: e.message }));
    child.on(opts.background ? "exit" : "close", (code) => done({ code: code ?? 1, stdout: out, stderr: err }));
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });

/** Tools the adapters may call. Presence is checked by name from this fixed list only. */
export const LINUX_TOOLS = ["xclip", "xsel", "wl-copy", "wl-paste", "xdotool", "wmctrl", "ydotool", "swaymsg", "hyprctl", "busctl"] as const;
export type LinuxTool = (typeof LINUX_TOOLS)[number];

export async function presentTools(run: Run): Promise<Set<LinuxTool>> {
  const script = `for t in ${LINUX_TOOLS.join(" ")}; do command -v "$t" >/dev/null 2>&1 && echo "$t"; done`;
  const r = await run("sh", ["-c", script], { timeoutMs: 3000 });
  const found = new Set<LinuxTool>();
  for (const line of r.stdout.split("\n")) if ((LINUX_TOOLS as readonly string[]).includes(line.trim())) found.add(line.trim() as LinuxTool);
  return found;
}
