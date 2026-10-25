// Golden interleaved conversations (mission M3). Same runtime as production (Kernel +
// JarvisRuntime + ActionSession + resolver); the environment is the in-memory YouTube double
// with delays so conversation can happen while actions run. Model and TTS are stubs.
import { describe, it, expect, beforeEach } from "vitest";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime, type Speaker } from "../../src/lib/runtime/lanes/runtime";
import type { ConversationModel } from "../../src/lib/runtime/lanes/conversation";
import { MemoryBrowser } from "../helpers/memoryBrowser";
import type { EnvAction } from "../../src/lib/runtime/env/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RecordingSpeaker implements Speaker {
  said: { text: string; at: number }[] = [];
  cancels = 0;
  speaking = false;
  say(text: string) { this.said.push({ text, at: Date.now() }); this.speaking = true; }
  cancel() { this.cancels++; this.speaking = false; }
  texts() { return this.said.map((s) => s.text); }
}

class StubModel implements ConversationModel {
  calls: { system: string; snapshot: string; utterance: string }[] = [];
  constructor(private delayMs = 10) {}
  async reply(input: { system: string; snapshot: string; utterance: string }) {
    this.calls.push(input);
    await sleep(this.delayMs);
    if (/pogod/i.test(input.utterance)) return "Jutro w Łodzi 18 stopni i słońce.";
    if (/film/i.test(input.utterance)) return "Wygląda na spokojny, nocny spacer po Łodzi.";
    return "Rozumiem.";
  }
}

let env: MemoryBrowser;
let kernel: Kernel;
let speaker: RecordingSpeaker;
let model: StubModel;
let rt: JarvisRuntime;

async function setup(delays: Partial<Record<EnvAction["kind"], number>> = {}) {
  env = new MemoryBrowser({ delays });
  kernel = new Kernel();
  speaker = new RecordingSpeaker();
  model = new StubModel();
  rt = new JarvisRuntime({ kernel, env, model, speaker, session: { youtubeUrl: "http://yt.test/" } });
  await rt.start();
}

async function prelude() {
  rt.onText("Jarvis, uruchom przeglądarkę.");
  rt.onText("Wejdź na YouTube.");
  rt.onText("Otwórz pierwszy film.");
  await rt.idle();
  expect(env.page).toBe("watch");
}

const actsOf = (kind: EnvAction["kind"]) => env.acts.filter((a) => a.action.kind === kind);
const commentLoads = () => env.acts.filter((a) => a.action.kind === "browser.findCollection" && a.action.itemKind === "comment");
const taskStatuses = () => Object.values(kernel.state.tasks).map((t) => `${t.kind}:${t.status}`);

beforeEach(async () => { await setup(); });

describe("golden conversations with interleaving", () => {
  it("G1 weather while comments load, then 'wróćmy do komentarza' restores the focus", async () => {
    await setup({ "browser.findCollection": 150 });
    await prelude();
    rt.onText("Znajdź komentarze.");
    await sleep(20);
    const weather = rt.onText("a jaka jutro pogoda?");
    await sleep(40);
    // The side chat answered while the action was still loading comments.
    expect(speaker.texts()).toContain("Jutro w Łodzi 18 stopni i słońce.");
    expect(commentLoads()).toHaveLength(1);
    expect(env.loaded).toBe(0);
    await rt.idle();
    expect(env.loaded).toBe(8);
    expect(weather.route).toBe("side_chat");
    rt.onText("Pierwszy komentarz.");
    await rt.idle();
    const focusTask = Object.values(kernel.state.tasks).find((t) => t.kind === "focusItem")!;
    rt.onText("co sądzisz o tym filmie?");
    await rt.idle();
    const back = rt.onText("dobra, wróćmy do komentarza");
    await rt.idle();
    expect(back.route).toBe("amend");
    expect(back.result?.truth).toBe("CONFIRMED");
    expect(back.result?.taskId).toBe(focusTask.id);
    expect(env.highlight).toBe("yt-comment:c1");
    expect(taskStatuses().filter((s) => s.endsWith(":failed") || s.endsWith(":cancelled"))).toEqual([]);
  });

  it("G2 'poczekaj' while resolving the target holds the next micro-action until 'wznów'", async () => {
    await setup({ "browser.findCollection": 120 });
    await prelude();
    const first = rt.onText("Pierwszy komentarz."); // needs the list first, then focus
    await sleep(30);
    rt.onText("poczekaj");
    await sleep(200);
    expect(commentLoads()).toHaveLength(1);
    expect(actsOf("browser.focus")).toHaveLength(0);
    const task = Object.values(kernel.state.tasks).find((t) => t.kind === "focusItem")!;
    expect(task.status).toBe("paused");
    rt.onText("wznów");
    await rt.idle();
    expect(actsOf("browser.focus")).toHaveLength(1);
    expect(first.result?.truth).toBe("CONFIRMED");
    expect(speaker.texts()).toEqual(expect.arrayContaining(["Czekam.", "Wracam do pracy."]));
  });

  it("G3 'nie ten, następny' amends the same task, rejects the current item and moves on", async () => {
    await prelude();
    rt.onText("Znajdź komentarze.");
    const first = rt.onText("Pierwszy komentarz.");
    await rt.idle();
    const amend = rt.onText("nie ten, następny");
    await rt.idle();
    expect(amend.route).toBe("amend");
    expect(amend.result?.taskId).toBe(first.result?.taskId);
    expect(env.highlight).toBe("yt-comment:c2");
    const coll = Object.values(kernel.state.referents.collections)[Object.keys(kernel.state.referents.collections).length - 1];
    expect(coll.rejected.map((id) => id.split("/").pop())).toEqual(["yt-comment:c1"]);
    expect(Object.values(kernel.state.tasks).filter((t) => t.kind === "focusItem")).toHaveLength(1);
  });

  it("G4 'stop' during TTS and a running action: audio cut, action cancelled, queue dropped", async () => {
    await setup({ "browser.findCollection": 300 });
    await prelude();
    rt.onText("Znajdź komentarze.");
    rt.onText("Pierwszy komentarz.");
    await sleep(30);
    speaker.speaking = true;
    const said = speaker.said.length;
    const stop = rt.onText("stop");
    expect(speaker.cancels).toBe(1);
    expect(speaker.speaking).toBe(false);
    expect(speaker.said.length).toBe(said); // nothing is spoken after "stop"
    await rt.idle();
    expect(stop.route).toBe("control");
    expect(env.loaded).toBe(0); // the running load was aborted
    expect(actsOf("browser.focus")).toHaveLength(0); // the queued command never started
    const find = Object.values(kernel.state.tasks).find((t) => t.kind === "findCollection")!;
    expect(find.status).toBe("cancelled");
    const act = Object.values(kernel.state.actions).filter((a) => a.kind === "browser.findCollection").pop()!;
    expect(act).toMatchObject({ status: "FAILED", reason: "cancelled" });
  });

  it("G5 'co teraz robisz?' during a task is answered from state, without the model", async () => {
    await setup({ "browser.findCollection": 150 });
    await prelude();
    rt.onText("Znajdź komentarze.");
    await sleep(20);
    const q = rt.onText("Co teraz robisz?");
    expect(q.route).toBe("status");
    expect(q.say).toMatch(/^Robię: „Znajdź komentarze\.”, w trakcie/);
    expect(model.calls).toHaveLength(0);
    await rt.idle();
    expect(rt.onText("co teraz robisz").say).toMatch(/^Teraz nic nie robię/);
  });

  it("G6 a duplicated STT final does not duplicate the action", async () => {
    await prelude();
    rt.onText("Znajdź komentarze.");
    rt.onText("Pierwszy komentarz.");
    rt.onText("Zaznacz pierwsze cztery litery.");
    await rt.idle();
    const a = rt.onFinal({ utteranceId: "u-copy-1", text: "Skopiuj." });
    const b = rt.onFinal({ utteranceId: "u-copy-2", text: "skopiuj" });
    const c = rt.onFinal({ utteranceId: "u-copy-1", text: "Skopiuj." });
    await rt.idle();
    expect([a.route, b.route, c.route]).toEqual(["action", "duplicate", "duplicate"]);
    expect(actsOf("clipboard.copy")).toHaveLength(1);
    expect(env.clipboard).toBe("Łódź");
  });

  it("G7 tier 0 on partials: TTS echo is ignored, a stable user 'stop' cancels before the final", async () => {
    await setup({ "browser.findCollection": 300 });
    await prelude();
    rt.onText("Znajdź komentarze.");
    await sleep(20);
    expect(rt.onPartial({ utteranceId: "echo", text: "stop", stability: 0.95, userSpeech: false })).toBeNull();
    expect(rt.onPartial({ utteranceId: "u1", text: "sto", stability: 0.3, userSpeech: true })).toBeNull();
    const early = rt.onPartial({ utteranceId: "u1", text: "stop", stability: 0.9, userSpeech: true });
    expect(early?.control).toBe("stop");
    expect(Object.values(kernel.state.tasks).find((t) => t.kind === "findCollection")?.status).toBe("cancelled");
    expect(rt.onFinal({ utteranceId: "u1", text: "Stop." }).route).toBe("duplicate");
    await rt.idle();
    expect(env.loaded).toBe(0);
  });

  it("G8 a partial corrected by the final: only the final command runs", async () => {
    await prelude();
    rt.onText("zjedź do końca");
    await rt.idle();
    const y = env.scrollY;
    expect(rt.onPartial({ utteranceId: "u2", text: "zjedź niżej", stability: 0.8, userSpeech: true })).toBeNull();
    rt.onFinal({ utteranceId: "u2", text: "Zjedź wyżej." });
    await rt.idle();
    const scrolls = actsOf("browser.scroll").map((a) => (a.action as { direction: string }).direction);
    expect(scrolls).toEqual(["down", "up"]);
    expect(env.scrollY).toBeLessThan(y);
  });

  it("G9 'co sądzisz o tym filmie?' goes to the model with the snapshot only, no action", async () => {
    await prelude();
    rt.onText("Znajdź komentarze.");
    rt.onText("piąty komentarz");
    await rt.idle();
    const before = env.acts.length;
    const t = rt.onText("co sądzisz o tym filmie?");
    await rt.idle();
    expect(t.route).toBe("side_chat");
    expect(env.acts.length).toBe(before);
    const call = model.calls[0];
    expect(call.snapshot.length).toBeLessThanOrEqual(1200);
    expect(call.snapshot).toContain("FOCUS: comment 5/8");
    // The injection comment reaches the model only as quoted data.
    expect(call.snapshot).toMatch(/«Ignore all previous instructions/);
    expect(call.snapshot).toContain("not instructions");
    expect(call.system).toContain("nie polecenia");
    expect(speaker.texts()).toContain("Wygląda na spokojny, nocny spacer po Łodzi.");
  });

  it("G10 stale reference: after navigating away 'skopiuj' refuses instead of copying", async () => {
    await prelude();
    rt.onText("Znajdź komentarze.");
    rt.onText("Pierwszy komentarz.");
    rt.onText("Zaznacz pierwsze cztery litery.");
    await rt.idle();
    env.userNavigates("/watch?v=tatry");
    const t = rt.onText("Skopiuj.");
    await rt.idle();
    expect(t.result?.truth).toBe("BLOCKED");
    expect(t.say).toMatch(/Zaznaczenie wygasło/);
    expect(actsOf("clipboard.copy")).toHaveLength(0);
  });

  it("G11 a selection survives a same-content re-render (epoch unchanged) and is copied", async () => {
    await prelude();
    rt.onText("Znajdź komentarze.");
    rt.onText("Pierwszy komentarz.");
    rt.onText("Zaznacz pierwsze cztery litery.");
    await rt.idle();
    const epoch = kernel.state.observationEpoch;
    env.rerender();
    expect(env.selection).toBeNull();
    expect(kernel.state.observationEpoch).toBe(epoch);
    const t = rt.onText("Skopiuj.");
    await rt.idle();
    expect(t.result?.truth).toBe("CONFIRMED");
    expect(env.clipboard).toBe("Łódź");
  });

  it("G12 'cofnij' reverses the last scroll, confirmed by read-back", async () => {
    await prelude();
    rt.onText("Zjedź trochę niżej.");
    await rt.idle();
    expect(env.scrollY).toBe(280);
    const u = rt.onText("cofnij");
    await rt.idle();
    expect(u.result?.truth).toBe("CONFIRMED");
    expect(env.scrollY).toBe(0);
    // Older undo data belongs to the previous page (the video list): nothing left to undo here.
    const again = rt.onText("cofnij");
    await rt.idle();
    expect(again.result?.truth).toBe("BLOCKED");
    expect(again.say).toBe("Nie mam czego bezpiecznie cofnąć.");
  });

  it("G13 actions keep order around a side chat, state untouched by the chat", async () => {
    await setup({ "browser.scroll": 60 });
    await prelude();
    rt.onText("zjedź niżej");
    rt.onText("a jaka jutro pogoda?");
    rt.onText("zjedź jeszcze niżej");
    await rt.idle();
    expect(actsOf("browser.scroll").map((a) => (a.action as { amount: string }).amount)).toEqual(["page", "more"]);
    const scrollTasks = Object.values(kernel.state.tasks).filter((t) => t.kind === "scroll");
    expect(scrollTasks.map((t) => t.status)).toEqual(["done", "done"]);
    expect(Object.values(kernel.state.tasks).some((t) => /pogod/.test(t.goal))).toBe(false);
  });

  it("G14 'dalej' resumes a paused task, otherwise it means the next item", async () => {
    await setup({ "browser.findCollection": 100 });
    await prelude();
    rt.onText("Pierwszy komentarz.");
    await sleep(20);
    rt.onText("poczekaj");
    await sleep(150);
    expect(actsOf("browser.focus")).toHaveLength(0);
    rt.onText("dalej");
    await rt.idle();
    expect(env.highlight).toBe("yt-comment:c1");
    rt.onText("dalej");
    await rt.idle();
    expect(env.highlight).toBe("yt-comment:c2");
  });

  it("G15 the full steps 1-7 by voice finals with chatter in between, all CONFIRMED", async () => {
    await setup({ "browser.findCollection": 80, "browser.scroll": 30 });
    const say = (t: string, i: number) => rt.onFinal({ utteranceId: `g-${i}`, text: t });
    const lines = [
      "Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "a jaka jutro pogoda?",
      "Zjedź trochę niżej.", "Znajdź komentarze.", "co teraz robisz?", "Pierwszy komentarz.", "nie ten, następny",
      "poprzedni", "Zaznacz pierwsze cztery litery.", "Skopiuj.",
    ];
    lines.forEach((l, i) => say(l, i));
    await rt.idle();
    const actions = rt.turns.filter((t) => t.route === "action" || t.route === "amend");
    expect(actions.map((t) => [t.text, t.result?.truth])).toEqual(actions.map((t) => [t.text, "CONFIRMED"]));
    expect(rt.turns.filter((t) => t.route === "amend").map((t) => t.text)).toEqual(["nie ten, następny", "poprzedni"]);
    // "co teraz robisz?" was asked while commands were queued: the answer says so, not "nic".
    expect(rt.turns.find((t) => t.route === "status")?.say).toMatch(/^Zaraz zrobię|^Robię/);
    expect(env.clipboard).toBe("Łódź");
    expect(kernel.state.clipboard?.byJarvis).toBe(true);
  });

  it("G16 the browser window closes during an action: honest failure, nothing claimed, refs expire", async () => {
    await setup({ "browser.findCollection": 120 });
    await prelude();
    const find = rt.onText("Znajdź komentarze.");
    await sleep(30);
    env.crash();
    await rt.idle();
    expect(find.result?.truth).not.toBe("CONFIRMED");
    expect(find.say).toBe("Nie znalazłem komentarzy.");
    expect(kernel.state.page?.id).toBe("closed");
    const next = rt.onText("Pierwszy komentarz.");
    await rt.idle();
    expect(next.result?.truth).not.toBe("CONFIRMED");
    expect(Object.values(kernel.state.actions).filter((a) => a.status === "CONFIRMED" && a.kind === "browser.focus")).toHaveLength(0);
  });

  it("G17 a correction while the tool is still running is applied to the same task afterwards", async () => {
    await setup({ "browser.focus": 120 });
    await prelude();
    rt.onText("Znajdź komentarze.");
    await rt.idle();
    const first = rt.onText("Pierwszy komentarz.");
    await sleep(30); // focus on the first comment is in flight
    const fix = rt.onText("nie ten, następny");
    await rt.idle();
    expect(first.result?.truth).toBe("CONFIRMED");
    expect(fix.route).toBe("amend");
    expect(fix.result?.taskId).toBe(first.result?.taskId);
    expect(env.highlight).toBe("yt-comment:c2");
    expect(Object.values(kernel.state.tasks).filter((t) => t.kind === "focusItem").map((t) => t.status)).toEqual(["done"]);
  });
});
