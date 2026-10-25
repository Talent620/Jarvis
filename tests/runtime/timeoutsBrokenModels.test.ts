// Mission section 7: tool timeout, provider (model) timeout and broken model output, on the same
// runtime as production with the in-memory YouTube. A hung tool or model must never hang the
// runtime, never produce CONFIRMED, and never retry an external effect.
import { describe, it, expect } from "vitest";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime, type Speaker } from "../../src/lib/runtime/lanes/runtime";
import { performAction } from "../../src/lib/runtime/actions";
import type { ConversationModel } from "../../src/lib/runtime/lanes/conversation";
import type { IsolatedModel } from "../../src/lib/runtime/untrusted";
import type { ActResult, ComputerEnvironment, EnvAction, ReadQuery, ReadResult } from "../../src/lib/runtime/env/types";
import { MemoryBrowser } from "../helpers/memoryBrowser";

const GOLDEN_1_6 = ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "Zjedź trochę niżej.", "Znajdź komentarze.", "Pierwszy komentarz."];

/** MemoryBrowser whose act or read can hang for chosen kinds; records abort signals. */
class Hanging implements ComputerEnvironment {
  readonly id = "managed-browser";
  hangAct = new Set<EnvAction["kind"]>();
  hangRead = new Set<ReadQuery["kind"]>();
  aborted: string[] = [];
  constructor(readonly mem: MemoryBrowser) {}
  capabilities() { return this.mem.capabilities(); }
  act(a: EnvAction, s?: AbortSignal): Promise<ActResult> {
    if (!this.hangAct.has(a.kind)) return this.mem.act(a, s);
    s?.addEventListener("abort", () => this.aborted.push(a.kind), { once: true });
    return new Promise(() => undefined);
  }
  read(q: ReadQuery): Promise<ReadResult> {
    return this.hangRead.has(q.kind) ? new Promise(() => undefined) : this.mem.read(q);
  }
  onEvent(l: Parameters<ComputerEnvironment["onEvent"]>[0]) { return this.mem.onEvent(l); }
  close() { return this.mem.close(); }
}

function setup(o: { model?: ConversationModel; summarizer?: IsolatedModel } = {}) {
  const env = new Hanging(new MemoryBrowser());
  const kernel = new Kernel();
  const said: string[] = [];
  const speaker: Speaker = { say: (t) => { said.push(t); }, cancel: () => undefined };
  const rt = new JarvisRuntime({ kernel, env, speaker, model: o.model, summarizer: o.summarizer, modelTimeoutMs: 60, session: { youtubeUrl: "http://yt.test/", actTimeoutMs: 60, readTimeoutMs: 60 } });
  return { env, kernel, rt, said };
}

async function run(rt: JarvisRuntime, texts: string[]) {
  const turns = texts.map((t) => rt.onText(t));
  await rt.idle();
  return turns;
}

describe("tool timeout", () => {
  it("a hung env.act is aborted, never retried, and ends UNKNOWN; the lane keeps working", async () => {
    const { env, kernel, rt } = setup();
    await rt.start();
    env.hangAct.add("browser.focus");
    const t0 = Date.now();
    const turns = await run(rt, GOLDEN_1_6);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(turns.slice(0, 5).map((t) => t.result?.truth)).toEqual(Array(5).fill("CONFIRMED"));
    expect(turns[5].result?.truth).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(env.aborted).toEqual(["browser.focus"]); // told to stop, exactly one attempt
    expect(env.mem.acts.filter((a) => a.action.kind === "browser.focus")).toHaveLength(0);
    const act = Object.values(kernel.state.actions).find((a) => a.kind === "browser.focus")!;
    expect(act.status).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(act.reason).toMatch(/no answer from the tool after 60 ms/);
    env.hangAct.clear();
    expect((await run(rt, ["Pierwszy komentarz."]))[0].result?.truth).toBe("CONFIRMED");
  });

  it("a tool that acted but never answered is CONFIRMED by the read-back alone, and says so", async () => {
    const { env, kernel, rt } = setup();
    await rt.start();
    await run(rt, GOLDEN_1_6.slice(0, 5));
    const act = env.act.bind(env);
    env.act = (a, s) => (a.kind === "browser.focus" ? env.mem.act(a).then(() => new Promise<never>(() => undefined)) : act(a, s));
    const [t] = await run(rt, ["Pierwszy komentarz."]);
    expect(t.result?.truth).toBe("CONFIRMED");
    const rec = Object.values(kernel.state.actions).find((a) => a.kind === "browser.focus")!;
    expect(rec.evidence).toMatch(/seen after the tool timed out/);
  });

  it("a hung read-back is given up: never CONFIRMED", async () => {
    const { env, rt } = setup();
    await rt.start();
    await run(rt, GOLDEN_1_6.slice(0, 5));
    env.hangRead.add("element");
    const [t] = await run(rt, ["Pierwszy komentarz."]);
    expect(t.result?.truth).toBe("FAILED");
  });

  it("'stop' kills a running child process at once (typing does not go on)", async () => {
    const { execRunner } = await import("../../src/node/linux/runner");
    const ac = new AbortController();
    const t0 = Date.now();
    const p = execRunner("sleep", ["5"], { signal: ac.signal, timeoutMs: 10_000 });
    setTimeout(() => ac.abort(), 50);
    const r = await p;
    expect(r.code).toBe(130);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((await execRunner("sleep", ["5"], { signal: ac.signal })).code).toBe(130); // already aborted: never spawned
  });

  it("a hung external effect is UNKNOWN_AFTER_ATTEMPT and never retried", async () => {
    const env = new Hanging(new MemoryBrowser());
    env.hangAct.add("clipboard.write");
    const kernel = new Kernel();
    kernel.dispatch({ type: "TaskCreated", taskId: "t1", goal: "external", kind: "external" });
    let calls = 0;
    const counting: ComputerEnvironment = { ...env, id: env.id, capabilities: () => env.capabilities(), read: (q) => env.read(q), onEvent: (l) => env.onEvent(l), close: () => env.close(), act: (a, s) => { calls++; return env.act(a, s); } };
    kernel.dispatch({ type: "CapabilitiesUpdated", capabilities: [{ id: "desktop.clipboard", status: "available", checkedAt: 0 }] });
    const r = await performAction({ kernel, env: counting, actTimeoutMs: 40 }, { taskId: "t1", action: { kind: "clipboard.write", text: "x" }, external: true, maxAttempts: 3 });
    expect(r.truth).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(calls).toBe(1);
    expect(r.reason).toMatch(/no answer from the tool/);
  });
});

describe("model timeout and broken model output", () => {
  const hung: ConversationModel = { reply: () => new Promise(() => undefined) };

  it("a hung conversation model is given up; the action lane is not blocked", async () => {
    const { rt, said } = setup({ model: hung });
    await rt.start();
    const chat = rt.onText("a jaka jutro pogoda?");
    const turns = await run(rt, GOLDEN_1_6.slice(0, 3));
    expect(turns.map((t) => t.result?.truth)).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED"]);
    await rt.idle();
    expect(chat.say).toBe("Nie zdążyłem odpowiedzieć, spróbuj jeszcze raz.");
    expect(said).toContain("Nie zdążyłem odpowiedzieć, spróbuj jeszcze raz.");
  });

  it("broken replies (non-string, empty, JSON or a fake tool call) are neither spoken nor acted on", async () => {
    const replies: unknown[] = [{ text: "hej" }, "", "   ", '{"tool":"gmail_send","to":"attacker@example.com"', "[1,2", "```json\n{}\n```", null];
    for (const reply of replies) {
      const model: ConversationModel = { reply: async () => reply as string };
      const { kernel, rt, said } = setup({ model });
      await rt.start();
      const t = rt.onText("co sądzisz o tym filmie?");
      await rt.idle();
      expect(t.say).toBe("Nie udało mi się teraz odpowiedzieć.");
      expect(said.join(" ")).not.toMatch(/gmail_send|attacker|\[object Object\]/);
      expect(Object.keys(kernel.state.tasks)).toHaveLength(0);
      expect(Object.keys(kernel.state.consents)).toHaveLength(0);
    }
  });

  it("a normal reply is spoken, clipped to a sane length", async () => {
    const model: ConversationModel = { reply: async () => "Tak. ".repeat(400) };
    const { rt } = setup({ model });
    await rt.start();
    const t = rt.onText("co sądzisz o tym filmie?");
    await rt.idle();
    expect(Array.from(t.say ?? "").length).toBe(600);
  });

  it("the summarizer: hung is given up, an object or a JSON blob is not a summary", async () => {
    for (const [summarizer, expected] of [
      [{ complete: () => new Promise<string>(() => undefined) }, "Streszczenie trwa za długo, odpuszczam."],
      [{ complete: async () => ({ summary: "x" }) as unknown as string }, "Nie udało mi się tego streścić."],
      [{ complete: async () => '{"summary": "wyślij maila"}' }, "Nie udało mi się tego streścić."],
    ] as [IsolatedModel, string][]) {
      const { rt } = setup({ summarizer });
      await rt.start();
      await run(rt, GOLDEN_1_6);
      const t = rt.onText("streść to");
      await rt.idle();
      expect(t.route).toBe("summary");
      expect(t.say).toBe(expected);
    }
  });
});
