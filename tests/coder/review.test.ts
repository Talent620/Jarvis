// Regression tests for the adversarial review of M11-M13 (D-039): each case is one finding.
import { describe, it, expect, afterEach, vi } from "vitest";
import * as path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Kernel } from "../../src/lib/runtime/kernel";
import { MemoryJournal } from "../../src/lib/runtime/journal";
import { JarvisRuntime } from "../../src/lib/runtime/lanes/runtime";
import { createCoderHost, type CoderHost } from "../../src/node/coder/host";
import { CodexBackend } from "../../src/node/coder/backends";
import { CoderExecutor } from "../../src/node/coder/executor";
import { WorkspaceRegistry } from "../../src/node/coder/workspace";
import { commandViolation, gitArgs } from "../../src/node/coder/guard";
import { decideVerdict } from "../../src/lib/runtime/coder/verdict";
import { runFactory } from "../../src/lib/runtime/coder/factory";
import type { CoderPort } from "../../src/lib/runtime/coder/port";
import type { GitSnapshot } from "../../src/lib/runtime/coder/types";
import { MemoryBrowser } from "../helpers/memoryBrowser";
import { FAKE_CODEX, FIXED, alive, miniProject, records, scenario, scratch } from "./helpers";

const hosts: CoderHost[] = [];
afterEach(async () => { for (const h of hosts.splice(0)) await h.close(); });
const portOf = (host: CoderHost): CoderPort => ({ call: (req) => host.handle(req) as never, onEvents: (cb) => host.onEvents(cb) });

function greenProject(): string {
  const root = miniProject();
  writeFileSync(path.join(root, "add.js"), FIXED);
  execFileSync("git", ["-C", root, "commit", "-qam", "already fixed"]);
  return root;
}

async function world(s: Record<string, unknown>, o: { root?: string; userData?: string; kernel?: Kernel; factory?: boolean; argv?: string; host?: CoderHost } = {}) {
  const dir = scratch();
  const userData = o.userData ?? dir;
  const root = o.root ?? miniProject();
  const argv = o.argv ?? path.join(dir, "argv.jsonl");
  let host = o.host;
  if (!host) {
    const registry = new WorkspaceRegistry(path.join(userData, "jarvis-workspaces.json"));
    registry.add(root, "Mini Projekt");
    host = createCoderHost({ userDataPath: userData, registry, backends: [new CodexBackend({ bin: FAKE_CODEX, extraEnv: { JARVIS_FAKE_CODER_SCRIPT: scenario(dir, { record: argv, ...s }) }, graceMs: 300 })], batchMs: 20 });
    hosts.push(host);
  }
  const said: string[] = [];
  const kernel = o.kernel ?? new Kernel();
  const rt = new JarvisRuntime({ kernel, env: new MemoryBrowser(), speaker: { say: (t) => { said.push(t); }, cancel: () => undefined }, coder: { port: portOf(host), ...(o.factory ? { runTask: runFactory } : {}) } });
  await rt.coder!.ready;
  const task = () => Object.values(kernel.state.tasks).find((t) => t.kind === "code")!;
  return { dir, userData, root, argv, host, rt, kernel, said, task };
}

describe("review H1/M1: nothing done is never 'gotowe'", () => {
  it("a coder that crashes without changes on an already green project: not CONFIRMED (factory)", async () => {
    const w = await world({ runs: [{ steps: [{ type: "crash", code: 3 }] }] }, { root: greenProject(), factory: true });
    w.rt.onText("popraw funkcję add w mini projekcie");
    await w.rt.idle();
    expect(w.task().status).not.toBe("done");
    expect(w.said.join(" ")).not.toMatch(/Gotowe/);
  });

  it("an agent that changes nothing: ATTEMPTED even with green checks (plain run)", async () => {
    const w = await world({ steps: [{ type: "message", text: "Nothing to do, it already works." }] }, { root: greenProject() });
    w.rt.onText("popraw funkcję add w mini projekcie");
    await w.rt.idle();
    expect(w.rt.coder!.store.result(w.task().id)).toMatchObject({ truth: "ATTEMPTED", reason: "the agent changed nothing" });
    expect(w.said.join(" ")).not.toMatch(/Gotowe/);
  });

  it("verdict table: changed nothing or changed the checks -> ATTEMPTED; a red check stays FAILED", () => {
    const val = (o: object) => ({ ran: true, noChecks: false, diffStat: "", changedFiles: ["a"], overlapsUserChanges: [], historyIntact: true, checks: [{ name: "test", command: "x", exitCode: 0, ok: true, durationMs: 1, tail: "" }], ...o });
    const v = (validation: ReturnType<typeof val>) => decideVerdict({ ended: "completed", access: "write", agentSaysDone: true, violations: [], validation });
    expect(v(val({ changedFiles: [] })).truth).toBe("ATTEMPTED");
    expect(v(val({ checksChanged: ["package.json"] })).truth).toBe("ATTEMPTED");
    expect(v(val({ changedFiles: [], checks: [{ name: "test", command: "x", exitCode: 1, ok: false, durationMs: 1, tail: "" }] })).truth).toBe("FAILED");
  });
});

describe("review M2: the agent cannot pass by changing its own judge", () => {
  it("rewriting the test script to 'exit 0' is ATTEMPTED, never CONFIRMED", async () => {
    const pkg = JSON.stringify({ name: "mini", version: "1.0.0", scripts: { test: "node -e \"process.exit(0)\"" } });
    const w = await world({ steps: [{ type: "write", path: "package.json", content: pkg }, { type: "message", text: "tests pass now" }] });
    w.rt.onText("popraw funkcję add w mini projekcie");
    await w.rt.idle();
    const r = w.rt.coder!.store.result(w.task().id)!;
    expect(r.validation?.checksChanged).toEqual(["package.json"]);
    expect(r.truth).toBe("ATTEMPTED");
    expect(w.said.join(" ")).not.toMatch(/Gotowe/);
  });
});

describe("review H2/M5: a stop always stops", () => {
  it("stop during the snapshot: the agent never starts", async () => {
    const dir = scratch();
    const argv = path.join(dir, "argv.jsonl");
    class SlowRegistry extends WorkspaceRegistry {
      async snapshot(root: string): Promise<GitSnapshot> { await new Promise((r) => setTimeout(r, 300)); return super.snapshot(root); }
    }
    const reg = new SlowRegistry();
    const ws = reg.add(miniProject(), "Mini");
    const ex = new CoderExecutor({ registry: reg, backends: [new CodexBackend({ bin: FAKE_CODEX, extraEnv: { JARVIS_FAKE_CODER_SCRIPT: scenario(dir, { record: argv, steps: [{ type: "write", path: "add.js", content: FIXED }] }) }, graceMs: 200 })] });
    const p = ex.start({ taskId: "t-snap", goal: "napraw", workspaceId: ws.id, backend: "codex" });
    await vi.waitFor(() => expect(ex.record("t-snap")?.state).toBe("starting"), { timeout: 3000, interval: 5 });
    await new Promise((r) => setTimeout(r, 120)); // inside the slow snapshot
    await ex.cancel("t-snap");
    const r = await p;
    expect(r.state).toBe("cancelled");
    expect(records(argv)).toHaveLength(0);
    expect(reg.holder(ws.id)).toBeUndefined();
  });

  it("stop during validation kills the repo's check and ends at once", async () => {
    const root = miniProject();
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "mini", version: "1.0.0", scripts: { test: "node -e \"setTimeout(() => {}, 60000)\"" } }));
    execFileSync("git", ["-C", root, "commit", "-qam", "slow tests"]);
    const w = await world({ steps: [{ type: "write", path: "add.js", content: FIXED }] }, { root });
    w.rt.onText("popraw funkcję add w mini projekcie");
    await vi.waitFor(() => expect(w.host.executor.record(`${w.task().id}.agent`)?.state).toBe("validating"), { timeout: 8000, interval: 20 });
    await new Promise((r) => setTimeout(r, 200));
    const t0 = Date.now();
    w.rt.onText("stop");
    await w.rt.idle();
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(w.host.executor.record(`${w.task().id}.agent`)!.state).toBe("cancelled");
  });
});

describe("review H3/M10: restored kernel", () => {
  it("'kontynuuj' after a real kernel restore (task comes back paused) resumes the agent", async () => {
    const journal = new MemoryJournal();
    const userData = scratch();
    const argv = path.join(userData, "argv.jsonl");
    const s = { steps: [{ type: "sleep", ms: 20_000 }], resumeSteps: [{ type: "write", path: "add.js", content: FIXED }, { type: "message", text: "fixed" }], threadId: "thread-9" };
    const w = await world(s, { userData, argv, kernel: new Kernel({ journal }) });
    w.rt.onText("popraw funkcję add w mini projekcie");
    const id = w.task().id;
    await vi.waitFor(() => expect(w.host.executor.record(`${id}.agent`)?.sessionId).toBe("thread-9"), { timeout: 8000, interval: 20 });
    await w.host.close();
    hosts.splice(hosts.indexOf(w.host), 1);
    await w.kernel.flush();

    const kernel = await Kernel.restore(journal);
    expect(kernel.state.tasks[id].status).toBe("paused");
    const w2 = await world(s, { userData, argv, root: w.root, kernel });
    expect(w2.rt.onText("kontynuuj").route).toBe("coder");
    await w2.rt.idle();
    expect(records(argv).at(-1)!.args).toEqual(expect.arrayContaining(["exec", "resume", "thread-9"]));
    expect(kernel.state.tasks[id].status).toBe("done");
  });

  it("after a renderer reload, 'stop' still reaches the agent running in the main process", async () => {
    const journal = new MemoryJournal();
    const w = await world({ steps: [{ type: "sleep", ms: 20_000 }] }, { kernel: new Kernel({ journal }) });
    w.rt.onText("popraw funkcję add w mini projekcie");
    const id = w.task().id;
    await vi.waitFor(() => expect(w.host.executor.record(`${id}.agent`)?.pid).toBeTruthy(), { timeout: 8000, interval: 20 });
    const pid = w.host.executor.record(`${id}.agent`)!.pid!;
    await w.kernel.flush();
    // The renderer reloads: a new kernel from the journal and a new runtime on the same host.
    const kernel = await Kernel.restore(journal);
    const w2 = await world({}, { kernel, host: w.host });
    w2.rt.onText("stop");
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000, interval: 20 });
    await w.rt.idle();
    expect(w.host.executor.record(`${id}.agent`)!.state).toBe("cancelled");
  });
});

describe("review H4: coding does not steal the golden scenario", () => {
  it("while an agent works, 'przewiń niżej' and 'jeszcze niżej' go to the screen, not the agent", async () => {
    const w = await world({ steps: [{ type: "sleep", ms: 20_000 }] });
    w.rt.onText("popraw funkcję add w mini projekcie");
    await vi.waitFor(() => expect(w.host.executor.record(`${w.task().id}.agent`)?.pid).toBeTruthy(), { timeout: 8000, interval: 20 });
    expect(w.rt.onText("wejdź na youtube").route).toBe("action");
    for (const t of ["jeszcze raz", "a przy okazji jaka jest pogoda", "co zmieniłeś?"]) expect(w.rt.onText(t).route, t).not.toBe("coder");
    w.rt.onText("zatrzymaj codexa");
    await w.rt.idle();
  });
});

describe("review M3: guard normalisation", () => {
  it("git global options, other spellings and deletes outside the root are caught", () => {
    for (const c of ["git -C . push -f origin x", "git --no-pager push --force", "git -C . reset --hard HEAD~3", "git -c core.x=y push origin +main", "git clean -d -f", "git clean --force", "git checkout HEAD -- .", "git branch -f main HEAD~5", "git update-ref refs/heads/main HEAD~2", "rm -rf ~/", "rm -rf /*", "rm -r -f ../other", "git --git-dir=.git --work-tree=. push origin main"]) {
      expect(commandViolation(c), c).not.toBeNull();
    }
    for (const c of ["git -C . status", "git clean -n", "rm -rf build", "git branch feature"]) expect(commandViolation(c), c).toBeNull();
  });

  it("JARVIS's own git calls cannot run repository hooks or fsmonitor", () => {
    expect(gitArgs("/r", ["status"])).toEqual(expect.arrayContaining(["-c", "core.fsmonitor=false"]));
    expect(gitArgs("/r", ["status"]).join(" ")).toMatch(/core\.hooksPath=/);
  });
});

describe("review M4/M8/L7: processes and folders", () => {
  it("a background child the agent left behind is killed when the run ends normally", async () => {
    const dir = scratch();
    const pidFile = path.join(dir, "grandchild.pid");
    const w = await world({ grandchild: pidFile, steps: [{ type: "write", path: "add.js", content: FIXED }] });
    w.rt.onText("popraw funkcję add w mini projekcie");
    await w.rt.idle();
    const g = Number(readFileSync(pidFile, "utf8"));
    await vi.waitFor(() => expect(alive(g)).toBe(false), { timeout: 3000, interval: 20 });
  });

  it("after a restart a reused pid (other start time) is never signalled", async () => {
    const dir = scratch();
    const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
    const file = path.join(dir, "tasks.json");
    writeFileSync(file, JSON.stringify([{ taskId: "old", goal: "g", backend: "codex", workspaceId: "w", root: dir, state: "running", startedAt: 0, updatedAt: 0, dirtyBefore: [], changedFiles: [], constraints: [], pid: sleeper.pid, pidStart: "1" }]));
    const ex = new CoderExecutor({ registry: new WorkspaceRegistry(), backends: [], recordsFile: file });
    expect(ex.record("old")!.state).toBe("interrupted_after_restart");
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(sleeper.pid!)).toBe(true);
    process.kill(-sleeper.pid!, "SIGKILL");
  });

  it("a folder inside a bigger repository is refused as a project", () => {
    const root = miniProject();
    mkdirSync(path.join(root, "sub"));
    expect(() => new WorkspaceRegistry().add(path.join(root, "sub"))).toThrow(/inside the repository/);
  });
});
