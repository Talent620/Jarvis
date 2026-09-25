// M12 pure parts: the Polish coding grammar, the IPC request allow-list, event batching, and the
// live store under load (10,000+ events: bounded memory, one notification per batch).
import { describe, it, expect } from "vitest";
import { parseCoderIntent, mightBeCoding } from "../../src/lib/runtime/coder/intent";
import { CoderLiveStore } from "../../src/lib/runtime/coder/live";
import { matchWorkspace } from "../../src/lib/runtime/coder/match";
import { createCoderHost } from "../../src/node/coder/host";
import { CoderExecutor } from "../../src/node/coder/executor";
import { WorkspaceRegistry } from "../../src/node/coder/workspace";
import type { CoderEvent, CoderEventKind } from "../../src/lib/runtime/coder/types";

const idle = { live: false, any: false, interrupted: false };
const live = { live: true, any: true, interrupted: false, focusedCode: true };
const liveElsewhere = { live: true, any: true, interrupted: false, focusedCode: false };

describe("coding grammar", () => {
  it("starts: write and read verbs, the backend named in words", () => {
    expect(parseCoderIntent("Przeanalizuj Sterownik Studio i napraw problem z naklejkami", idle)).toMatchObject({ kind: "start", access: "write" });
    expect(parseCoderIntent("przeanalizuj projekt Jarvis", idle)).toMatchObject({ kind: "start", access: "read", explicit: true });
    expect(parseCoderIntent("użyj Codexa, żeby naprawić testy w Jarvisie", idle)).toMatchObject({ kind: "start", backend: "codex" });
    expect(parseCoderIntent("zrefaktoruj moduł płatności przez Claude Code", idle)).toMatchObject({ kind: "start", backend: "claude", access: "write" });
    expect(parseCoderIntent("zaimplementuj eksport do CSV lokalnym modelem", idle)).toMatchObject({ kind: "start", backend: "local" });
    for (const chat of ["jaka jest pogoda", "wejdź na YouTube", "przewiń niżej", "skopiuj to", "napisz maila do Marcina"]) expect(parseCoderIntent(chat, idle), chat).toBeNull();
    expect(mightBeCoding("napraw testy")).toBe(true);
    expect(mightBeCoding("wejdź na youtube")).toBe(false);
  });

  it("changes to a running task only while one runs", () => {
    expect(parseCoderIntent("nie rób release", live)).toEqual({ kind: "constraint", constraint: "nie rób release" });
    expect(parseCoderIntent("najpierw przetestuj", live)).toEqual({ kind: "constraint", constraint: "najpierw przetestuj" });
    expect(parseCoderIntent("i nie commituj", live)).toEqual({ kind: "constraint", constraint: "nie commituj" });
    expect(parseCoderIntent("nie ruszaj pliku config.ts", live)).toEqual({ kind: "constraint", constraint: "nie zmieniaj pliku config ts" });
    expect(parseCoderIntent("Dodaj jeszcze obsługę błędów w API.", live)).toEqual({ kind: "instruction", instruction: "obsługę błędów w API" });
    expect(parseCoderIntent("i przy okazji popraw README", live)).toEqual({ kind: "instruction", instruction: "popraw README" });
    expect(parseCoderIntent("nie rób release", idle)).toBeNull();
    expect(parseCoderIntent("dodaj jeszcze mleko", idle)).toBeNull();
    expect(parseCoderIntent("zatrzymaj codexa", live)).toEqual({ kind: "stop" });
    expect(parseCoderIntent("wstrzymaj agenta", live)).toEqual({ kind: "pause" });
    expect(parseCoderIntent("co teraz robi codex?", live)).toEqual({ kind: "status" });
    expect(parseCoderIntent("jak idzie agentowi", live)).toEqual({ kind: "status" });
    expect(parseCoderIntent("pokaż zmiany", live)).toEqual({ kind: "diff" });
    expect(parseCoderIntent("kontynuuj", { ...idle, interrupted: true })).toEqual({ kind: "continue" });
    expect(parseCoderIntent("kontynuuj", idle)).toBeNull();
  });

  it("while an agent works, screen commands and chat stay with the rest of JARVIS", () => {
    // Review H4: none of these may reach the agent.
    for (const t of ["jeszcze raz", "jeszcze niżej", "i jeszcze wyślij to do Marcina", "a przy okazji jaka jest pogoda", "nie zmieniaj tematu maila", "co zmieniłeś?"]) {
      expect(parseCoderIntent(t, live), t).toBeNull();
    }
    expect(parseCoderIntent("dodaj jeszcze test do add", liveElsewhere)).toBeNull(); // the browser task is in focus
    expect(parseCoderIntent("niech codex doda jeszcze test", liveElsewhere)).toBeNull();
    expect(parseCoderIntent("codex, dodaj jeszcze test do add", liveElsewhere)).toEqual({ kind: "instruction", instruction: "test do add" });
    expect(parseCoderIntent("pokaż zmiany", liveElsewhere)).toBeNull();
    expect(parseCoderIntent("pokaż diff", liveElsewhere)).toEqual({ kind: "diff" });
    expect(parseCoderIntent("co codex zmienił?", liveElsewhere)).toEqual({ kind: "diff" });
    expect(parseCoderIntent("nie rób release", { ...live, screenCommand: true })).toBeNull();
  });

  it("project names: generic words do not decide", () => {
    const list = [{ name: "Mini Projekt" }, { name: "Sterownik Studio" }, { name: "repo" }];
    expect(matchWorkspace(list, "napraw w projekcie Zeta")).toBeUndefined();
    expect(matchWorkspace(list, "napraw w mini projekcie")?.name).toBe("Mini Projekt");
    expect(matchWorkspace(list, "w sterowniku studio")?.name).toBe("Sterownik Studio");
    expect(matchWorkspace(list, "przejrzyj repo")?.name).toBe("repo");
  });
});

describe("coder IPC host", () => {
  const host = () => createCoderHost({ registry: new WorkspaceRegistry(), backends: [] });

  it("rejects anything outside the allow-list before it reaches the executor", async () => {
    const h = host();
    for (const bad of [null, "x", { method: "exec", cmd: "rm -rf /" }, { method: "start" }, { method: "start", spec: { taskId: "../x", goal: "g", workspaceId: "w", backend: "auto" } },
      { method: "start", spec: { taskId: "t", goal: "g", workspaceId: "w", backend: "sh" } }, { method: "start", spec: { taskId: "t", goal: "", workspaceId: "w", backend: "auto" } },
      { method: "cancel", taskId: "a b" }, { method: "amend", taskId: "t", instruction: "x".repeat(3000) }, { method: "log", taskId: "t", limit: 1e9 },
      { method: "pickWorkspace" }, { method: "addWorkspace", root: 5 }]) {
      const r = await h.handle(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
    const ok = await h.handle({ method: "start", spec: { taskId: "t1", goal: "napraw", workspaceId: "nope", backend: "auto", timeoutMs: 1 } });
    expect(ok).toMatchObject({ ok: true, value: { truth: "BLOCKED", reason: "that project is not added to JARVIS (add it in CODE)" } });
    expect(await h.handle({ method: "history" })).toMatchObject({ ok: true });
  });

  it("batches events: many agent lines are few IPC messages; a task's end is flushed at once", async () => {
    const reg = new WorkspaceRegistry();
    const ex = new CoderExecutor({ registry: reg, backends: [] });
    let emit!: (e: CoderEvent) => void;
    (ex as unknown as { onEvent: (fn: (e: CoderEvent) => void) => () => void }).onEvent = (fn) => { emit = fn; return () => undefined; };
    const h = createCoderHost({ registry: reg, executor: ex, batchMs: 30, maxBatch: 200 });
    const batches: CoderEvent[][] = [];
    h.onEvents((b) => batches.push(b));
    for (let i = 1; i <= 1000; i++) emit({ taskId: "t", seq: i, at: i, kind: "READING_FILE", text: "x" });
    expect(batches.length).toBe(5); // flushed by size
    emit({ taskId: "t", seq: 1001, at: 1, kind: "MESSAGE", text: "tail" });
    expect(batches.length).toBe(5);
    emit({ taskId: "t", seq: 1002, at: 1, kind: "TASK_COMPLETED", text: "CONFIRMED" });
    expect(batches.length).toBe(6);
    expect(batches[5].map((e) => e.seq)).toEqual([1001, 1002]);
  });
});

describe("live store under load", () => {
  const KINDS: CoderEventKind[] = ["READING_FILE", "SEARCHING", "EDITING_FILE", "RUNNING_COMMAND", "RUNNING_TEST", "MESSAGE"];

  it("10,000 events in batches: bounded log, state correct, one notification per batch, fast", async () => {
    const store = new CoderLiveStore({ logLimit: 500 });
    store.begin({ taskId: "t", goal: "g", backend: "codex", workspace: "w", state: "running", changedFiles: [], startedAt: 0, dirty: 0 });
    let notified = 0;
    store.subscribe(() => { notified++; });
    const N = 10_000;
    const events: CoderEvent[] = Array.from({ length: N }, (_, i) => {
      const kind = KINDS[i % KINDS.length];
      return { taskId: "t", seq: i + 1, at: i, kind, text: `line ${i}`, file: kind === "EDITING_FILE" ? `src/f${i % 50}.ts` : undefined, tests: kind === "RUNNING_TEST" ? { passed: i, failed: 0 } : undefined };
    });
    const t0 = performance.now();
    for (let i = 0; i < N; i += 100) store.ingest(events.slice(i, i + 100)); // the host's batches
    const ingestMs = performance.now() - t0;
    await Promise.resolve();
    expect(notified).toBe(1); // coalesced: views re-render once, not per event
    const s1 = store.snapshot();
    expect(store.snapshot()).toBe(s1); // no rebuild without a change
    const live = store.get("t")!;
    expect(live.changedFiles).toHaveLength(25); // every 6th event edits one of src/f{2,8,...}.ts
    expect(live.tests).toEqual({ passed: 9_994, failed: 0 });
    expect(store.log("t", 10_000).length).toBeLessThanOrEqual(500);
    expect(store.log("t", 1)[0].seq).toBe(N);
    // A replayed batch changes nothing.
    store.ingest(events.slice(0, 100));
    expect(store.applied).toBe(N);
    // Generous bound for slow CI; measured locally in docs/JARVIS-PERFORMANCE.md.
    expect(ingestMs).toBeLessThan(500);
  });
});

describe("CODER section and diagnostics", () => {
  it("the live card shows goal, backend, project, branch, stage, file, command, changes, tests, and the buttons", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { CoderLiveCard } = await import("../../src/components/CodePanel");
    const { RuntimeStatusPanel } = await import("../../src/components/RuntimeStatusPanel");
    const task = { taskId: "t", goal: "napraw test", backend: "codex" as const, model: "gpt-5-codex", workspace: "Mini", branch: "main", state: "running" as const, stage: "running tests", currentFile: "add.js", currentCommand: "npm test", changedFiles: ["add.js"], tests: { passed: 3, failed: 1 }, startedAt: 0, dirty: 0, lastCheckpoint: "agent started" };
    const card = createElement(CoderLiveCard, { task, now: 65_000, onStop: () => {}, onPause: () => {}, onResume: () => {}, onDiff: () => {} });
    const view = { state: "idle" as const, environment: "managed-browser", recent: [], canPause: false, canResume: false, canStop: false };
    const html = renderToStaticMarkup(createElement(RuntimeStatusPanel, { view, coder: card }));
    for (const want of ["CODER", "Codex CLI (gpt-5-codex): pracuje", "napraw test", "Mini, gałąź main", "running tests", "add.js", "npm test", "1 plik", "FAIL: 3 przeszło, 1 nie", "1 min 5 s", "PAUZA", "STOP", "POKAŻ ZMIANY"]) expect(html).toContain(want);
  });

  it("diagnostics carry coding tasks as states and counts only (no goal text, no file names)", async () => {
    const { exportDiagnostics } = await import("../../src/lib/runtime/diagnostics");
    const { Kernel } = await import("../../src/lib/runtime/kernel");
    const d = exportDiagnostics({
      state: new Kernel().state, environment: "x", now: 0,
      coder: {
        tasks: [{ taskId: "t", goal: "sekretny cel", backend: "codex", workspace: "w", state: "failed", changedFiles: ["tajny.ts"], startedAt: 0, dirty: 0, tests: { passed: 1, failed: 1 } }],
        results: { t: { taskId: "t", state: "failed", truth: "FAILED", backend: "codex", agentSaysDone: true, violations: [], reason: "test failed", validation: { ran: true, noChecks: false, diffStat: "", changedFiles: ["tajny.ts"], overlapsUserChanges: [], historyIntact: true, checks: [{ name: "test", command: "npm test", exitCode: 1, ok: false, durationMs: 1, tail: "" }] } } },
      },
    });
    expect(d.coder).toEqual([{ id: "t", backend: "codex", state: "failed", truth: "FAILED", changedFiles: 1, tests: { passed: 1, failed: 1 }, checks: "test:FAIL", reason: "test failed", violations: undefined }]);
    expect(JSON.stringify(d)).not.toMatch(/sekretny|tajny/);
  });
});
