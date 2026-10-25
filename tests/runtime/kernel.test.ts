import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { Kernel, TaskAbortedError } from "../../src/lib/runtime/kernel";
import { DexieJournal, MemoryJournal } from "../../src/lib/runtime/journal";
import { focusedTaskId, CLIPBOARD_REFERENT_ID } from "../../src/lib/runtime/reducer";
import type { EventInput } from "../../src/lib/runtime/events";

let t = 1_000;
const now = () => t;
let n = 0;
const newId = (p: string) => `${p}${++n}`;

function mk(journal?: MemoryJournal) {
  return new Kernel({ now, newId, journal });
}

const createTask = (k: Kernel, taskId = "A", goal = "find comments") =>
  k.dispatch({ type: "TaskCreated", taskId, goal, kind: "browser.findComments", steps: [{ id: "s1", intent: "scroll" }] });

beforeEach(() => { t = 1_000; n = 0; });

describe("kernel dispatch and dedup", () => {
  it("assigns id and timestamp and increments seq", () => {
    const k = mk();
    const r = k.dispatch({ type: "SpeechPartial", utteranceId: "u1", text: "zjedź", stability: 0.5, userSpeech: true });
    expect(r.accepted).toBe(true);
    if (r.accepted) { expect(r.event.id).toBe("ev1"); expect(r.event.at).toBe(1_000); }
    expect(k.state.seq).toBe(1);
  });

  it("drops a repeated event id", () => {
    const k = mk();
    const e: EventInput = { id: "x", type: "SpeechFinal", utteranceId: "u1", text: "stop", confidence: 0.9 };
    expect(k.dispatch(e).accepted).toBe(true);
    expect(k.dispatch(e)).toEqual({ accepted: false, reason: "duplicate_id" });
  });

  it("drops a second final for the same utterance", () => {
    const k = mk();
    k.dispatch({ type: "SpeechFinal", utteranceId: "u1", text: "wyślij to", confidence: 0.9 });
    expect(k.dispatch({ type: "SpeechFinal", utteranceId: "u1", text: "wyślij to mailem", confidence: 0.9 }))
      .toEqual({ accepted: false, reason: "duplicate_utterance" });
  });

  it("drops the same final text from a different utterance id inside the window", () => {
    const k = mk();
    k.dispatch({ type: "SpeechFinal", utteranceId: "u1", text: "Wyślij to.", confidence: 0.9 });
    t += 800;
    expect(k.dispatch({ type: "SpeechFinal", utteranceId: "u2", text: "wyślij to", confidence: 0.9 }))
      .toEqual({ accepted: false, reason: "duplicate_final_text" });
    t += 2_000;
    expect(k.dispatch({ type: "SpeechFinal", utteranceId: "u3", text: "wyślij to", confidence: 0.9 }).accepted).toBe(true);
  });

  it("drops a control repeated for the same utterance (partial then final)", () => {
    const k = mk();
    createTask(k);
    expect(k.dispatch({ type: "ControlIntent", control: "stop", tier: 0, utteranceId: "u9" }).accepted).toBe(true);
    expect(k.dispatch({ type: "ControlIntent", control: "stop", tier: 2, utteranceId: "u9" }).accepted).toBe(false);
  });
});

describe("tasks, focus and cancellation", () => {
  it("creates a running, focused task with a live signal", () => {
    const k = mk();
    createTask(k);
    expect(k.state.tasks.A.status).toBe("running");
    expect(focusedTaskId(k.state)).toBe("A");
    expect(k.signal("A").aborted).toBe(false);
  });

  it("stop cancels the focused task and aborts its signal immediately", async () => {
    const k = mk();
    createTask(k);
    const sig = k.signal("A");
    k.dispatch({ type: "ControlIntent", control: "stop", tier: 0 });
    expect(k.state.tasks.A.status).toBe("cancelled");
    expect(sig.aborted).toBe(true);
    expect(sig.reason).toBeInstanceOf(TaskAbortedError);
    await expect(k.waitRunnable("A")).rejects.toBeInstanceOf(TaskAbortedError);
    expect(k.state.focusStack).toEqual([]);
  });

  it("pause blocks waitRunnable until resume", async () => {
    const k = mk();
    createTask(k);
    k.dispatch({ type: "ControlIntent", control: "pause", tier: 0 });
    expect(k.state.tasks.A.status).toBe("paused");
    let resumed = false;
    const p = k.waitRunnable("A").then(() => { resumed = true; });
    await Promise.resolve();
    expect(resumed).toBe(false);
    k.dispatch({ type: "ControlIntent", control: "resume", tier: 0 });
    await p;
    expect(resumed).toBe(true);
    expect(k.signal("A").aborted).toBe(false);
  });

  it("cancel while paused rejects the waiter", async () => {
    const k = mk();
    createTask(k);
    k.dispatch({ type: "ConversationIntent", intent: "PAUSE", text: "poczekaj" });
    const p = k.waitRunnable("A");
    k.dispatch({ type: "ConversationIntent", intent: "CANCEL", text: "anuluj" });
    await expect(p).rejects.toBeInstanceOf(TaskAbortedError);
  });

  it("side chat does not touch the running task", () => {
    const k = mk();
    createTask(k);
    const before = k.state.tasks.A;
    k.dispatch({ type: "ConversationIntent", intent: "SIDE_CHAT", text: "a jaka jutro pogoda?" });
    expect(k.state.tasks.A).toBe(before);
    expect(k.state.lastIntent?.intent).toBe("SIDE_CHAT");
  });

  it("keeps a focus stack and resume brings the paused task back on top", () => {
    const k = mk();
    createTask(k, "A");
    k.dispatch({ type: "ControlIntent", control: "pause", tier: 0 });
    createTask(k, "B", "weather");
    expect(k.state.focusStack).toEqual(["A", "B"]);
    k.dispatch({ type: "TaskStatusChanged", taskId: "B", status: "done" });
    expect(k.state.focusStack).toEqual(["A"]);
    k.dispatch({ type: "ControlIntent", control: "resume", tier: 0 });
    expect(k.state.tasks.A.status).toBe("running");
    expect(focusedTaskId(k.state)).toBe("A");
  });

  it("ignores status changes on finished tasks", () => {
    const k = mk();
    createTask(k);
    k.dispatch({ type: "TaskCancelled", taskId: "A", reason: "user" });
    k.dispatch({ type: "TaskStatusChanged", taskId: "A", status: "running" });
    expect(k.state.tasks.A.status).toBe("cancelled");
  });

  it("unknown task gets an already aborted signal", () => {
    expect(mk().signal("nope").aborted).toBe(true);
  });
});

describe("actions: truth and idempotency", () => {
  const start = (k: Kernel, actionId: string, key?: string, external = false) =>
    k.dispatch({ type: "ActionStarted", actionId, taskId: "A", kind: "mail.send", argsHash: "h", idempotencyKey: key, external });

  it("rejects a second action with the same idempotency key", () => {
    const k = mk();
    createTask(k);
    expect(start(k, "a1", "send:1", true).accepted).toBe(true);
    expect(start(k, "a2", "send:1", true)).toEqual({ accepted: false, reason: "idempotency_conflict", existingActionId: "a1" });
  });

  it("a clean failure releases the key, an unknown outcome keeps it", () => {
    const k = mk();
    createTask(k);
    start(k, "a1", "k1");
    k.dispatch({ type: "ActionFailed", actionId: "a1", reason: "boom", truth: "FAILED" });
    expect(start(k, "a2", "k1").accepted).toBe(true);
    k.dispatch({ type: "ActionFailed", actionId: "a2", reason: "timeout", truth: "UNKNOWN_AFTER_ATTEMPT" });
    expect(start(k, "a3", "k1").accepted).toBe(false);
  });

  it("an attempted external action never degrades to a clean FAILED", () => {
    const k = mk();
    createTask(k);
    start(k, "a1", "k1", true);
    k.dispatch({ type: "ActionAttempted", actionId: "a1" });
    k.dispatch({ type: "ActionFailed", actionId: "a1", reason: "network", truth: "FAILED" });
    expect(k.state.actions.a1.status).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(start(k, "a2", "k1", true).accepted).toBe(false);
  });

  it("verification without evidence is not CONFIRMED", () => {
    const k = mk();
    createTask(k);
    start(k, "a1");
    k.dispatch({ type: "ActionVerified", actionId: "a1", evidence: "  " });
    expect(k.state.actions.a1.status).toBe("ATTEMPTED");
    k.dispatch({ type: "ActionVerified", actionId: "a1", evidence: "scrollY 0 -> 400", undo: { actionId: "a1", kind: "scroll", data: { scrollY: 0 } } });
    expect(k.state.actions.a1.status).toBe("CONFIRMED");
    expect(k.state.lastVerifiedActionId).toBe("a1");
    expect(k.state.tasks.A.undo).toHaveLength(1);
  });

  it("a confirmed action cannot be failed afterwards", () => {
    const k = mk();
    createTask(k);
    start(k, "a1");
    k.dispatch({ type: "ActionVerified", actionId: "a1", evidence: "ok readback" });
    k.dispatch({ type: "ActionFailed", actionId: "a1", reason: "late error", truth: "FAILED" });
    expect(k.state.actions.a1.status).toBe("CONFIRMED");
  });
});

describe("observations and referent epochs", () => {
  const addEl = (k: Kernel, id: string, scope = "page1", type: "Element" | "Contact" = "Element") =>
    k.dispatch({
      type: "ReferentAdded",
      referent: { id, type, source: "test", scope, semanticKey: id, confidence: 1, salience: 0.5, metadata: {} },
    });

  it("navigation bumps the epoch and invalidates screen-bound referents only", () => {
    const k = mk();
    addEl(k, "el1");
    addEl(k, "c1", undefined, "Contact");
    k.dispatch({ type: "ClipboardChanged", hash: "h1", preview: "Łódź", byJarvis: true, provenance: "UNTRUSTED_WEB" });
    k.dispatch({ type: "ObservationReceived", env: "b", kind: "navigation", page: { id: "page2", url: "https://x.test/", title: "X" } });
    expect(k.state.observationEpoch).toBe(1);
    expect(k.state.referents.byId.el1.valid).toBe(false);
    expect(k.state.referents.byId.el1.invalidatedReason).toBe("navigation");
    expect(k.state.referents.byId.c1.valid).toBe(true);
    expect(k.state.referents.byId[CLIPBOARD_REFERENT_ID].valid).toBe(true);
    expect(k.state.page?.epoch).toBe(1);
  });

  it("a major DOM change invalidates only its scope", () => {
    const k = mk();
    addEl(k, "el1", "page1");
    addEl(k, "el2", "page2");
    k.dispatch({ type: "ObservationReceived", env: "b", kind: "dom_major", scope: "page1" });
    expect(k.state.referents.byId.el1.valid).toBe(false);
    expect(k.state.referents.byId.el2.valid).toBe(true);
  });

  it("minor observations do not bump the epoch", () => {
    const k = mk();
    k.dispatch({ type: "ObservationReceived", env: "b", kind: "scroll", page: { id: "p", url: "u", title: "t", scrollY: 300 } });
    expect(k.state.observationEpoch).toBe(0);
    expect(k.state.page?.scrollY).toBe(300);
  });

  it("clipboard keeps the hash JARVIS wrote after an external change", () => {
    const k = mk();
    k.dispatch({ type: "ClipboardChanged", hash: "mine", preview: "Łódź", byJarvis: true, provenance: "UNTRUSTED_WEB" });
    k.dispatch({ type: "ClipboardChanged", hash: "theirs", preview: "hack", byJarvis: false, provenance: "UNTRUSTED_CLIPBOARD" });
    expect(k.state.clipboard?.jarvisHash).toBe("mine");
    expect(k.state.clipboard?.hash).toBe("theirs");
  });
});

describe("consent", () => {
  it("request waits, grant resumes, deny blocks", () => {
    const k = mk();
    createTask(k);
    k.dispatch({ type: "ConsentRequested", consentId: "c1", taskId: "A", summary: "Send mail", args: { to: "marcin@example.com" } });
    expect(k.state.tasks.A.status).toBe("waiting_consent");
    k.dispatch({ type: "ConsentGranted", consentId: "c1" });
    expect(k.state.tasks.A.status).toBe("running");
    k.dispatch({ type: "ConsentGranted", consentId: "c1" });
    expect(k.state.consents.c1.status).toBe("granted");
    k.dispatch({ type: "ConsentRequested", consentId: "c2", taskId: "A", summary: "again", args: {} });
    k.dispatch({ type: "ConsentDenied", consentId: "c2" });
    expect(k.state.tasks.A.status).toBe("blocked");
  });
});

describe("listeners", () => {
  it("re-entrant dispatch from a listener is applied in order", () => {
    const k = mk();
    const seen: string[] = [];
    k.subscribe((_s, e) => {
      seen.push(e.type);
      if (e.type === "TaskCreated") k.dispatch({ type: "TaskStepChanged", taskId: "A", stepId: "s1", status: "running" });
    });
    createTask(k);
    expect(seen).toEqual(["TaskCreated", "TaskStepChanged"]);
    expect(k.state.tasks.A.currentStepId).toBe("s1");
  });

  it("a throwing listener does not break others", () => {
    const k = mk();
    let ok = 0;
    k.subscribe(() => { throw new Error("bad"); });
    k.subscribe(() => { ok++; });
    createTask(k);
    expect(ok).toBe(1);
  });

  it("unsubscribe stops notifications", () => {
    const k = mk();
    let c = 0;
    const off = k.subscribe(() => { c++; });
    createTask(k);
    off();
    createTask(k, "B");
    expect(c).toBe(1);
  });
});

describe("journal", () => {
  it("persists only durable events, batched", async () => {
    const j = new MemoryJournal();
    const k = mk(j);
    for (let i = 0; i < 500; i++) {
      k.dispatch({ type: "SpeechPartial", utteranceId: `u${i}`, text: "x", stability: 0.1, userSpeech: true });
      k.dispatch({ type: "ObservationReceived", env: "b", kind: "scroll" });
    }
    createTask(k);
    k.dispatch({ type: "TaskStepChanged", taskId: "A", stepId: "s1", status: "running" });
    await k.flush();
    expect(j.events.map((e) => e.type)).toEqual(["TaskCreated", "TaskStepChanged"]);
    expect(j.appendCalls).toBe(1);
  });

  it("retries a failed journal write on the next flush", async () => {
    const j = new MemoryJournal();
    const k = mk(j);
    j.failNext = true;
    createTask(k);
    await k.flush();
    expect(k.journalErrors).toBe(1);
    expect(j.events).toHaveLength(0);
    k.dispatch({ type: "TaskCancelled", taskId: "A", reason: "user" });
    await k.flush();
    expect(j.events.map((e) => e.type)).toEqual(["TaskCreated", "TaskCancelled"]);
  });

  it("restores after restart: running tasks paused, possible effects unknown, pending consent denied", async () => {
    const j = new MemoryJournal();
    const k = mk(j);
    createTask(k);
    k.dispatch({ type: "ActionStarted", actionId: "send1", taskId: "A", kind: "mail.send", argsHash: "h", idempotencyKey: "mail:1", external: true });
    k.dispatch({ type: "ActionStarted", actionId: "scroll1", taskId: "A", kind: "scroll", argsHash: "h2" });
    k.dispatch({ type: "ConsentRequested", consentId: "c1", taskId: "A", summary: "x", args: {} });
    await k.flush();

    const r = await Kernel.restore(j, { now, newId });
    expect(r.state.tasks.A.status).toBe("paused");
    expect(r.state.tasks.A.statusReason).toBe("restored after restart");
    expect(r.state.actions.send1.status).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(r.state.actions.scroll1.status).toBe("FAILED");
    expect(r.state.consents.c1.status).toBe("denied");
    // The idempotency key survives the restart: no second send.
    expect(r.dispatch({ type: "ActionStarted", actionId: "send2", taskId: "A", kind: "mail.send", argsHash: "h", idempotencyKey: "mail:1", external: true }).accepted).toBe(false);
    // Replaying an already journaled event id is ignored.
    const first = j.events[0];
    expect(r.dispatch({ ...first } as EventInput).accepted).toBe(false);
    // Resume works on the restored kernel.
    r.dispatch({ type: "ControlIntent", control: "resume", tier: 0 });
    expect(r.state.tasks.A.status).toBe("running");
    expect(r.signal("A").aborted).toBe(false);
  });

  it("DexieJournal round-trips and compacts", async () => {
    const j = new DexieJournal(`jarvis-runtime-test-${Math.random()}`, 10);
    const k = mk(j as unknown as MemoryJournal);
    for (let i = 0; i < 15; i++) createTask(k, `T${i}`);
    await k.flush();
    const loaded = await j.load();
    expect(loaded.length).toBeLessThanOrEqual(12);
    expect(loaded[loaded.length - 1].type).toBe("TaskCreated");
    await j.clear();
    expect(await j.load()).toEqual([]);
    j.close();
  });
});
