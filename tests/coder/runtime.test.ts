// M12 live coding control: a coding command is a kernel task inside the JARVIS runtime, driven over
// the same request/event contract as the Electron IPC (CoderHost), with a fake Codex CLI that
// speaks the real JSONL protocol. No network, no model, no paid call.
import { describe, it, expect, afterEach, vi } from "vitest";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime } from "../../src/lib/runtime/lanes/runtime";
import { createCoderHost, type CoderHost } from "../../src/node/coder/host";
import { CodexBackend } from "../../src/node/coder/backends";
import { WorkspaceRegistry } from "../../src/node/coder/workspace";
import type { CoderPort } from "../../src/lib/runtime/coder/port";
import { MemoryBrowser } from "../helpers/memoryBrowser";
import { BUGGY, FAKE_CODEX, FIXED, alive, miniProject, read, records, scenario, scratch } from "./helpers";

const FIX = [
  { type: "reasoning", text: "**Reading the failing test**" },
  { type: "write", path: "add.js", content: FIXED },
  { type: "cmd", command: "npm test", run: ["node", "test.js"] },
];

const hosts: CoderHost[] = [];
afterEach(async () => { for (const h of hosts.splice(0)) await h.close(); });

export const portOf = (host: CoderHost): CoderPort => ({ call: (req) => host.handle(req) as never, onEvents: (cb) => host.onEvents(cb) });

async function world(s: Record<string, unknown>, o: { userData?: string; root?: string; argv?: string } = {}) {
  const dir = scratch();
  const userData = o.userData ?? dir;
  const root = o.root ?? miniProject();
  const argv = o.argv ?? path.join(dir, "argv.jsonl");
  const registry = new WorkspaceRegistry(path.join(userData, "jarvis-workspaces.json"));
  registry.add(root, "Mini Projekt");
  const codex = new CodexBackend({ bin: FAKE_CODEX, extraEnv: { JARVIS_FAKE_CODER_SCRIPT: scenario(dir, { record: argv, ...s }) }, graceMs: 300 });
  const host = createCoderHost({ userDataPath: userData, registry, backends: [codex], batchMs: 20 });
  hosts.push(host);
  const said: string[] = [];
  const kernel = new Kernel();
  const rt = new JarvisRuntime({ kernel, env: new MemoryBrowser(), speaker: { say: (t) => { said.push(t); }, cancel: () => undefined }, coder: { port: portOf(host) } });
  await rt.coder!.ready;
  const codeTasks = () => Object.values(kernel.state.tasks).filter((t) => t.kind === "code");
  const running = () => vi.waitFor(() => {
    const t = codeTasks().at(-1);
    expect(t && host.executor.record(t.id)?.pid).toBeTruthy();
  }, { timeout: 8000, interval: 20 });
  return { dir, userData, root, argv, host, rt, kernel, said, codeTasks, running };
}

describe("M12 a coding command is a kernel task", () => {
  it("'napraw test w Mini Projekcie': kernel task kind code, live events, CONFIRMED only after the repo's own test", async () => {
    const w = await world({ steps: FIX });
    const turn = w.rt.onText("Napraw test w Mini Projekcie");
    expect(turn.route).toBe("coder");
    expect(w.said[0]).toMatch(/^Zaczynam w Mini Projekt/);
    // The browser lane is not blocked by the agent.
    expect(w.rt.isBusy()).toBe(false);
    await w.rt.idle();
    const [task] = w.codeTasks();
    expect(task).toMatchObject({ kind: "code", status: "done" });
    const action = Object.values(w.kernel.state.actions).find((a) => a.taskId === task.id)!;
    expect(action).toMatchObject({ kind: "coder.run", status: "CONFIRMED" });
    expect(action.evidence).toContain("test PASS");
    expect(task.steps.find((s) => s.id === "validate")?.status).toBe("CONFIRMED");
    expect(w.said.at(-1)).toMatch(/^Gotowe i sprawdzone w Mini Projekt: test PASS.*Zmienione: 1 plik\./);
    expect(read(w.root, "add.js")).toBe(FIXED);
    const live = w.rt.coder!.store.get(task.id)!;
    expect(live).toMatchObject({ state: "completed", backend: "codex", changedFiles: ["add.js"] });
    expect(w.rt.coder!.store.log(task.id).map((e) => e.kind)).toEqual(expect.arrayContaining(["TASK_STARTED", "EDITING_FILE", "RUNNING_TEST", "VALIDATING", "CHECK_RESULT", "TASK_COMPLETED"]));
  });

  it("8 at runtime level: the agent says done but the test is red -> spoken as not done, task failed", async () => {
    const w = await world({ steps: [{ type: "message", text: "All tests pass, done!" }] });
    w.rt.onText("napraw testy w mini projekcie");
    await w.rt.idle();
    const [task] = w.codeTasks();
    expect(task.status).toBe("failed");
    expect(Object.values(w.kernel.state.actions)[0].status).toBe("FAILED");
    expect(w.said.at(-1)).toBe("Codex mówi, że skończył, ale test nie przechodzi. Nie uznaję tego za gotowe.");
    expect(w.said.join(" ")).not.toMatch(/Gotowe/);
  });

  it("18 a duplicated final (same id, same words twice) starts one agent and one task", async () => {
    const w = await world({ steps: FIX });
    const a = w.rt.onFinal({ utteranceId: "u1", text: "napraw test w mini projekcie" });
    const b = w.rt.onFinal({ utteranceId: "u1", text: "napraw test w mini projekcie" });
    const c = w.rt.onFinal({ utteranceId: "u2", text: "napraw test w mini projekcie" });
    expect([a.route, b.route, c.route]).toEqual(["coder", "duplicate", "duplicate"]);
    // Even the controller itself: the same utterance twice is one run.
    w.rt.coder!.handle("u1", "napraw test w mini projekcie");
    await w.rt.idle();
    expect(w.codeTasks()).toHaveLength(1);
    expect(records(w.argv)).toHaveLength(1);
  });

  it("backends become kernel capabilities (never with credentials)", async () => {
    const w = await world({ steps: FIX });
    const probes = await w.rt.coder!.probe();
    expect(probes[0]).toMatchObject({ id: "codex", availability: "ready", version: "codex-cli 0.157.0" });
    expect(w.kernel.state.capabilities["coder.codex"]).toMatchObject({ status: "available", provider: "codex-cli 0.157.0" });
  });

  it("unknown project: says which ones it knows; plain chat is never claimed", async () => {
    const w = await world({ steps: FIX });
    const t = w.rt.onText("napraw testy w projekcie Zeta");
    expect(t.route).toBe("coder");
    expect(w.said.at(-1)).toBe("Nie wiem, w którym projekcie. Znam: Mini Projekt.");
    expect(w.rt.claims("jaka jest jutro pogoda", () => false)).toBe(false);
    expect(w.rt.claims("opowiedz mi dowcip", () => false)).toBe(false);
    expect(w.codeTasks()).toHaveLength(0);
  });
});

describe("M12 live control by voice", () => {
  it("19 'co teraz robi codex?' is answered from the agent's events and does not disturb its process", async () => {
    const w = await world({ steps: [...FIX, { type: "sleep", ms: 1500 }, { type: "message", text: "done" }] });
    w.rt.onText("napraw test w mini projekcie");
    await w.running();
    const id = w.codeTasks()[0].id;
    await vi.waitFor(() => expect(w.rt.coder!.store.get(id)?.tests).toBeTruthy(), { timeout: 8000, interval: 20 });
    const pid = w.host.executor.record(id)!.pid!;
    const turn = w.rt.onText("co teraz robi codex?");
    expect(turn.route).toBe("coder");
    expect(turn.say).toMatch(/^Codex pracuje: „napraw test w mini projekcie” w Mini Projekt \(gałąź main\)\./);
    expect(turn.say).toContain("Zmienione: 1 plik.");
    expect(turn.say).toContain("Testy: 1 przeszedł, 0 nie.");
    // The general question too, and the answer is not invented from elapsed time.
    const general = w.rt.onText("co teraz robisz?");
    expect(general.route).toBe("status");
    expect(general.say).toMatch(/^Codex pracuje/);
    expect(alive(pid)).toBe(true);
    expect(w.host.executor.record(id)!.pid).toBe(pid);
    await w.rt.idle();
    expect(w.codeTasks()[0].status).toBe("done");
  });

  it("'stop' cancels the kernel task and kills the agent; silence afterwards; changes stay", async () => {
    const w = await world({ steps: [{ type: "write", path: "add.js", content: FIXED }, { type: "sleep", ms: 20_000 }] });
    w.rt.onText("napraw test w mini projekcie");
    await w.running();
    const id = w.codeTasks()[0].id;
    await vi.waitFor(() => expect(w.rt.coder!.store.get(id)?.changedFiles).toEqual(["add.js"]), { timeout: 5000, interval: 20 });
    const pid = w.host.executor.record(id)!.pid!;
    const before = w.said.length;
    w.rt.onText("stop");
    await w.rt.idle();
    expect(w.kernel.state.tasks[id].status).toBe("cancelled");
    expect(alive(pid)).toBe(false);
    expect(w.host.executor.record(id)!.state).toBe("cancelled");
    expect(w.said.length).toBe(before);
    expect(read(w.root, "add.js")).toBe(FIXED); // nothing is reverted behind the user's back
  });

  it("'pauza' suspends the agent process and 'wznów' continues it to a verified end", async () => {
    const w = await world({ steps: [{ type: "sleep", ms: 600 }, ...FIX] });
    w.rt.onText("napraw test w mini projekcie");
    await w.running();
    const id = w.codeTasks()[0].id;
    w.rt.onText("pauza");
    await vi.waitFor(() => expect(w.host.executor.record(id)!.state).toBe("paused"), { timeout: 5000, interval: 20 });
    expect(w.kernel.state.tasks[id].status).toBe("paused");
    const pid = w.host.executor.record(id)!.pid!;
    // Stopped by SIGSTOP (the signal lands asynchronously under load).
    await vi.waitFor(() => expect(readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[2]).toBe("T"), { timeout: 3000, interval: 10 });
    w.rt.onText("wznów");
    await w.rt.idle();
    expect(w.kernel.state.tasks[id].status).toBe("done");
  });

  it("20 AMEND during work: 'nie rób release' is enforced, 'dodaj jeszcze X' reaches the same task", async () => {
    const w = await world({ steps: [{ type: "sleep", ms: 700 }, { type: "cmd", command: "git tag v2.0.0" }] });
    w.rt.onText("napraw test w mini projekcie");
    await w.running();
    const id = w.codeTasks()[0].id;
    const t = w.rt.onText("nie rób release");
    expect(t.route).toBe("coder");
    await w.rt.idle();
    expect(w.said).toContain("Dobrze: nie rób release. Pilnuję tego do końca zadania.");
    expect(w.kernel.state.tasks[id].statusReason ?? "").not.toBe("");
    expect(w.host.executor.record(id)!.result).toMatchObject({ truth: "BLOCKED", violations: ["tagging a release"] });
    expect(w.said.at(-1)).toBe("Zatrzymałem agenta, bo próbował zrobić coś zabronionego: tagging a release.");

    const w2 = await world({ steps: [{ type: "sleep", ms: 700 }, ...FIX], resumeSteps: [{ type: "message", text: "comment added" }] });
    w2.rt.onText("napraw test w mini projekcie");
    await w2.running();
    const id2 = w2.codeTasks()[0].id;
    w2.rt.onText("dodaj jeszcze komentarz na górze pliku add.js");
    await w2.rt.idle();
    expect(w2.said).toContain("Dodam to, gdy agent skończy obecny krok: „komentarz na górze pliku add.js”.");
    const calls = records(w2.argv);
    expect(calls).toHaveLength(2);
    expect(calls[1].args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(calls[1].prompt).toContain("komentarz na górze pliku add.js");
    expect(w2.codeTasks()).toHaveLength(1);
    expect(w2.kernel.state.tasks[id2].status).toBe("done");
  });

  it("'pokaż zmiany' shows the redacted diff of the task", async () => {
    const w = await world({ steps: FIX });
    w.rt.onText("napraw test w mini projekcie");
    await w.rt.idle();
    w.rt.onText("pokaż zmiany");
    await w.rt.idle();
    const id = w.codeTasks()[0].id;
    expect(w.rt.coder!.store.diffTaskId).toBe(id);
    expect(w.rt.coder!.store.diff(id)).toContain("+module.exports = function add(a, b) { return a + b; };");
    expect(w.said.at(-1)).toBe("Pokazuję zmiany w zakładce KOD: 1 plik.");
  });
});

describe("M12 restart", () => {
  it("JARVIS closes during a task: the agent is killed, the task is INTERRUPTED_AFTER_RESTART; 'kontynuuj' resumes it", async () => {
    const userData = scratch();
    const argv = path.join(userData, "argv.jsonl");
    const s = { steps: [{ type: "reasoning", text: "**Planning**" }, { type: "sleep", ms: 20_000 }], resumeSteps: [{ type: "write", path: "add.js", content: FIXED }, { type: "message", text: "fixed" }], threadId: "thread-42" };
    const w = await world(s, { userData, argv });
    w.rt.onText("napraw test w mini projekcie");
    await w.running();
    const id = w.codeTasks()[0].id;
    await vi.waitFor(() => expect(w.host.executor.record(id)?.sessionId).toBe("thread-42"), { timeout: 5000, interval: 20 });
    const pid = w.host.executor.record(id)!.pid!;
    await w.host.close();
    hosts.splice(hosts.indexOf(w.host), 1);
    expect(alive(pid)).toBe(false);
    expect(w.host.executor.record(id)!.state).toBe("interrupted_after_restart");
    expect(read(w.root, "add.js")).toBe(BUGGY);

    // A new app start: new host from the same userData, a new runtime.
    const w2 = await world(s, { userData, root: w.root, argv });
    const turn = w2.rt.onText("kontynuuj");
    expect(turn.route).toBe("coder");
    expect(w2.said[0]).toMatch(/^Wracam do „napraw test w mini projekcie” w Mini Projekt\. Zaczynam od obecnego stanu repozytorium/);
    await w2.rt.idle();
    const calls = records(argv);
    expect(calls).toHaveLength(2);
    expect(calls[1].args).toEqual(expect.arrayContaining(["exec", "resume", "thread-42"]));
    expect(calls[1].prompt).toContain("This continues an interrupted task");
    const [task] = w2.codeTasks();
    expect(task.status).toBe("done");
    expect(w2.host.executor.record(id)!.resumedBy).toBe(task.id);
    // Not offered again.
    expect(w2.rt.claims("kontynuuj", () => false)).toBe(false);
  });
});
