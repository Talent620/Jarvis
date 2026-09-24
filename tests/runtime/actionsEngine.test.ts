import { describe, it, expect } from "vitest";
import { Kernel } from "../../src/lib/runtime/kernel";
import { performAction } from "../../src/lib/runtime/actions";
import { verify } from "../../src/lib/runtime/postconditions";
import { parseCommand } from "../../src/lib/runtime/commands";
import type { ActResult, ComputerEnvironment, EnvAction, EnvEvent, ReadQuery, ReadResult } from "../../src/lib/runtime/env/types";
import type { CapabilityState } from "../../src/lib/runtime/types";

/** Scripted environment: act/read answers come from queues, calls are recorded. */
class ScriptedEnv implements ComputerEnvironment {
  readonly id = "scripted";
  acts: EnvAction[] = [];
  reads: ReadQuery[] = [];
  constructor(private actQueue: ActResult[], private readQueue: ReadResult[], private caps: CapabilityState[] = [
    { id: "browser.managed.semantic", status: "available", checkedAt: 0 },
  ]) {}
  async capabilities() { return this.caps; }
  async act(a: EnvAction, signal?: AbortSignal): Promise<ActResult> {
    this.acts.push(a);
    if (signal?.aborted) return { status: "failed", error: "aborted" };
    return this.actQueue.shift() ?? { status: "done" };
  }
  async read(q: ReadQuery): Promise<ReadResult> {
    this.reads.push(q);
    const r = this.readQueue.shift();
    if (!r) throw new Error("no read scripted");
    return r;
  }
  onEvent(_l: (e: EnvEvent) => void) { return () => {}; }
  async close() {}
}

async function setup(env: ScriptedEnv) {
  const k = new Kernel();
  k.dispatch({ type: "CapabilitiesUpdated", capabilities: await env.capabilities() });
  k.dispatch({ type: "TaskCreated", taskId: "T", goal: "g", kind: "k", steps: [{ id: "s", intent: "x" }] });
  return k;
}

const page = (scrollY: number, extra: Record<string, unknown> = {}) => ({ open: true, url: "http://x.test/", scrollY, viewportHeight: 800, documentHeight: 5000, ...extra });

describe("performAction", () => {
  it("confirms on a matching read-back and records evidence and undo", async () => {
    const env = new ScriptedEnv([{ status: "done", undo: { scrollY: 0 } }], [page(0), page(280)]);
    const k = await setup(env);
    const r = await performAction({ kernel: k, env }, { taskId: "T", stepId: "s", action: { kind: "browser.scroll", direction: "down", amount: "little" } });
    expect(r).toMatchObject({ truth: "CONFIRMED", evidence: "scrollY 0 -> 280", attempts: 1 });
    expect(k.state.actions[r.actionId!].status).toBe("CONFIRMED");
    expect(k.state.tasks.T.undo[0]).toMatchObject({ kind: "browser.scroll", data: { scrollY: 0 } });
    expect(k.state.tasks.T.steps[0].status).toBe("CONFIRMED");
  });

  it("an 'ok' without matching read-back is retried once, then FAILED (never CONFIRMED)", async () => {
    const env = new ScriptedEnv([{ status: "done" }, { status: "done" }], [page(0), page(0), page(0)]);
    const k = await setup(env);
    const r = await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "browser.scroll", direction: "down", amount: "page" } });
    expect(r.truth).toBe("FAILED");
    expect(r.attempts).toBe(2);
    expect(env.acts).toHaveLength(2);
    expect(k.state.actions[r.actionId!].status).toBe("FAILED");
  });

  it("at the end of the page scrolling down is BLOCKED and not retried", async () => {
    const env = new ScriptedEnv([{ status: "done" }], [page(4200), page(4200)]);
    const k = await setup(env);
    const r = await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "browser.scroll", direction: "down", amount: "page" } });
    expect(r.truth).toBe("BLOCKED");
    expect(env.acts).toHaveLength(1);
  });

  it("an external effect is attempted once; an unverified send is UNKNOWN_AFTER_ATTEMPT", async () => {
    const env = new ScriptedEnv([{ status: "done" }], [{ ok: true, text: "other" }]);
    const k = await setup(env);
    const r = await performAction({ kernel: k, env }, { taskId: "T", external: true, idempotencyKey: "k1", action: { kind: "clipboard.copy", expected: "Łódź" } });
    expect(r.truth).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(env.acts).toHaveLength(1);
    // The idempotency key stays taken: a duplicate request does not act again.
    const again = await performAction({ kernel: k, env }, { taskId: "T", external: true, idempotencyKey: "k1", action: { kind: "clipboard.copy", expected: "Łódź" } });
    expect(again.reason).toMatch(/duplicate/);
    expect(env.acts).toHaveLength(1);
  });

  it("missing capability: NEEDS_CAPABILITY without starting an action", async () => {
    const env = new ScriptedEnv([], [], []);
    const k = await setup(env);
    const r = await performAction({ kernel: k, env }, { taskId: "T", stepId: "s", action: { kind: "browser.launch" } });
    expect(r.truth).toBe("NEEDS_CAPABILITY");
    expect(env.acts).toHaveLength(0);
    expect(Object.keys(k.state.actions)).toHaveLength(0);
    expect(k.state.tasks.T.steps[0].status).toBe("NEEDS_CAPABILITY");
  });

  it("needs_permission from the environment is reported as NEEDS_PERMISSION, not FAILED", async () => {
    const env = new ScriptedEnv([{ status: "needs_permission", error: "portal consent missing" }], [page(0)]);
    const k = await setup(env);
    const r = await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "browser.launch" } });
    expect(r.truth).toBe("NEEDS_PERMISSION");
    expect(env.acts).toHaveLength(1);
  });

  it("stop before acting: nothing runs, the action ends cancelled", async () => {
    const env = new ScriptedEnv([], []);
    const k = await setup(env);
    k.dispatch({ type: "ControlIntent", control: "stop", tier: 0 });
    const r = await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "browser.launch" } });
    expect(r).toMatchObject({ truth: "FAILED", reason: "cancelled" });
    expect(env.acts).toHaveLength(0);
  });

  it("a read-back error is never treated as success", async () => {
    const env = new ScriptedEnv([{ status: "done" }, { status: "done" }], []);
    const k = await setup(env);
    const r = await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "browser.launch" } });
    expect(r.truth).toBe("FAILED");
    expect(r.reason).toMatch(/read-back failed/);
  });
});

describe("postconditions", () => {
  const done: ActResult = { status: "done" };
  it("selection must equal the expected text, be visible and in the target", () => {
    const a: EnvAction = { kind: "text.select", target: { ref: "yt-comment:c1" }, start: 0, end: 4, expected: "Łódź" };
    expect(verify(a, undefined, { text: "Łódź", visible: true, ref: "yt-comment:c1" }, done, 0).truth).toBe("CONFIRMED");
    expect(verify(a, undefined, { text: "Łódź", visible: false, ref: "yt-comment:c1" }, done, 0).truth).toBe("ATTEMPTED");
    expect(verify(a, undefined, { text: "Łódź", visible: true, ref: "yt-comment:c2" }, done, 0).truth).toBe("ATTEMPTED");
    expect(verify(a, undefined, { text: "Łód", visible: true }, done, 0).truth).toBe("ATTEMPTED");
  });

  it("clipboard: unreadable is ATTEMPTED, mismatch is ATTEMPTED, match is CONFIRMED", () => {
    const a: EnvAction = { kind: "clipboard.copy", expected: "Łódź" };
    expect(verify(a, undefined, { ok: false, error: "denied" }, done, 0)).toMatchObject({ truth: "ATTEMPTED" });
    expect(verify(a, undefined, { ok: true, text: "x" }, done, 0).truth).toBe("ATTEMPTED");
    expect(verify(a, undefined, { ok: true, text: "Łódź" }, done, 0).truth).toBe("CONFIRMED");
  });

  it("navigation: same host, or the Google/YouTube consent host, counts as arrived", () => {
    const a: EnvAction = { kind: "browser.navigate", url: "https://www.youtube.com/" };
    expect(verify(a, undefined, { open: true, url: "https://www.youtube.com/" }, done, 0).truth).toBe("CONFIRMED");
    expect(verify(a, undefined, { open: true, url: "https://consent.youtube.com/m?continue=x", consentWall: true }, done, 0).truth).toBe("CONFIRMED");
    expect(verify(a, undefined, { open: true, url: "https://evil.example/" }, done, 0).truth).toBe("ATTEMPTED");
  });

  it("an environment failure is FAILED, not found is FAILED with reason", () => {
    expect(verify({ kind: "browser.launch" }, undefined, { open: false }, { status: "failed", error: "boom" }, 0).truth).toBe("FAILED");
    expect(verify({ kind: "browser.focus", target: { ref: "x" } }, undefined, { found: false }, { status: "not_found" }, 0)).toMatchObject({ truth: "FAILED" });
  });

  it("findCollection with more needs strictly more items than before", () => {
    const a: EnvAction = { kind: "browser.findCollection", itemKind: "comment", more: true };
    expect(verify(a, { count: 8, items: [] }, { count: 8, items: [] }, done, 0).truth).toBe("ATTEMPTED");
    expect(verify(a, { count: 8, items: [] }, { count: 15, items: [] }, done, 0).truth).toBe("CONFIRMED");
  });
});

describe("Polish command grammar (golden steps and variants)", () => {
  it.each([
    ["Jarvis, uruchom przeglądarkę.", "browser.launch"],
    ["otwórz przeglądarkę", "browser.launch"],
    ["odpal chrome'a", "browser.launch"],
    ["Wejdź na YouTube.", "browser.gotoSite"],
    ["wejdz na jutuba", "browser.gotoSite"],
    ["Otwórz pierwszy film.", "browser.openItem"],
    ["puść drugi filmik", "browser.openItem"],
    ["Zjedź trochę niżej.", "scroll"],
    ["możesz zjechać?", "scroll"],
    ["zjedź no", "scroll"],
    ["przewiń do końca", "scroll"],
    ["wyżej", "scroll"],
    ["Znajdź komentarze.", "findCollection"],
    ["pokaż więcej komentarzy", "findCollection"],
    ["Pierwszy komentarz.", "focusItem"],
    ["nie ten, następny", "focusItem"],
    ["poprzedni", "focusItem"],
    ["Zaznacz pierwsze cztery litery.", "selectText"],
    ["Skopiuj.", "copy"],
    ["skopiuj to", "copy"],
  ])("%s -> %s", (text, type) => {
    expect(parseCommand(text).type).toBe(type);
  });

  it("scroll amounts and directions", () => {
    expect(parseCommand("Zjedź trochę niżej.")).toEqual({ type: "scroll", direction: "down", amount: "little" });
    expect(parseCommand("zjedź jeszcze niżej")).toEqual({ type: "scroll", direction: "down", amount: "more" });
    expect(parseCommand("przewiń do końca")).toEqual({ type: "scroll", direction: "down", amount: "end" });
    expect(parseCommand("wyżej")).toEqual({ type: "scroll", direction: "up", amount: "page" });
  });

  it("wejdź na YouTube i otwórz film opens the first video", () => {
    expect(parseCommand("Wejdź na YouTube i otwórz film")).toEqual({ type: "browser.gotoSite", site: "youtube", openFirst: true });
  });

  it("an unrelated sentence is not turned into an action", () => {
    expect(parseCommand("a jaka jutro pogoda?").type).toBe("unknown");
    expect(parseCommand("co sądzisz o tym filmie?").type).toBe("unknown");
  });
});
