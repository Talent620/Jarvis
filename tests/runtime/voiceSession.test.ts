// Voice session state machine (mission 5.14, M5) on synthetic and scripted event streams:
// barge-in cancels speech at once, our own voice is not a command, wake word and push-to-talk
// gate the microphone, partials only speculate (reads), latency is measured.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime } from "../../src/lib/runtime/lanes/runtime";
import type { ConversationModel } from "../../src/lib/runtime/lanes/conversation";
import { VoiceSession, sentences, type VoiceSessionEvent } from "../../src/lib/runtime/voice/session";
import { deepgramParser } from "../../src/lib/runtime/voice/adapters";
import type { ListenMode } from "../../src/lib/runtime/voice/types";
import { MemoryBrowser } from "../helpers/memoryBrowser";
import { MockMail } from "../helpers/mockMail";
import { FakeTTS, ScriptedSTT, speakInto } from "../helpers/voice";

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
};

function rig(opts: { mode?: ListenMode; model?: ConversationModel; playMs?: number; clock?: { t: number }; speculate?: (t: string) => void } = {}) {
  const clock = opts.clock;
  const now = clock ? () => clock.t : () => Date.now();
  const stt = new ScriptedSTT();
  const tts = new FakeTTS(opts.playMs ?? 5);
  const events: VoiceSessionEvent[] = [];
  const voice = new VoiceSession({ stt, tts, mode: opts.mode, now, onEvent: (e) => events.push(e), speculate: opts.speculate });
  const kernel = new Kernel({ now });
  const mail = new MockMail();
  const rt = new JarvisRuntime({
    kernel, env: new MemoryBrowser(), model: opts.model, speaker: voice, now,
    session: {
      youtubeUrl: "http://yt.test/", mail, mailOptions: { timeoutMs: 40, recheckDelayMs: 5 },
      contacts: async () => [{ id: "m1", name: "Marcin Kubicki", emails: ["marcin.kubicki@example.com"], source: "fixture" }],
    },
  });
  voice.attach(rt);
  return { stt, tts, voice, kernel, rt, mail, events, at: now };
}

describe("voice session", () => {
  it("golden 1-8 spoken, with chatter and one spoken consent: mail sent, every action confirmed, latency measured", async () => {
    const model: ConversationModel = { reply: async () => "Jutro w Łodzi 18 stopni." };
    const r = rig({ model });
    await r.rt.start();
    await r.voice.start();
    const lines = ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "a jaka jutro pogoda?", "Zjedź trochę niżej.",
      "Znajdź komentarze.", "Pierwszy komentarz.", "Zaznacz pierwsze cztery litery.", "Skopiuj.", "Wyślij to mailem Marcinowi."];
    for (const l of lines) {
      speakInto(r.stt, l, r.at);
      if (l.startsWith("Wyślij")) break; // the send waits for the spoken consent below
      await r.rt.idle();
      await until(() => !r.voice.speaking);
    }
    await until(() => Object.keys(r.kernel.state.consents).length === 1);
    await until(() => !r.voice.speaking);
    speakInto(r.stt, "tak", r.at);
    await r.rt.idle();
    expect(r.mail.sent).toEqual([expect.objectContaining({ to: "marcin.kubicki@example.com", body: "Łódź" })]);
    const actions = r.rt.turns.filter((t) => t.route === "action");
    expect(actions.map((t) => t.result?.truth)).toEqual(Array(9).fill("CONFIRMED"));
    expect(r.tts.spoken).toContain("Jutro w Łodzi 18 stopni.");
    expect(r.tts.spoken.some((s) => s.startsWith("Wysłać mail do Marcin Kubicki"))).toBe(true);
    const lat = r.voice.latency.summary();
    console.log(`voice latency on fixtures (ms): ${JSON.stringify(lat)}`);
    expect(lat.final_to_intent.count).toBeGreaterThanOrEqual(11);
    expect(lat.final_to_verified.count).toBeGreaterThanOrEqual(8);
    expect(lat.final_to_first_audio.count).toBeGreaterThanOrEqual(10);
    await r.voice.stop();
    r.rt.stop();
  });

  it("the same stream from the Deepgram protocol drives the runtime to the same end", async () => {
    const r = rig();
    await r.rt.start();
    await r.voice.start();
    const parse = deepgramParser((e) => r.stt.emit(e), r.at);
    const msgs = readFileSync("tests/fixtures/voice/deepgram-golden.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
    for (const m of msgs) {
      parse(m);
      const closed = m.type === "UtteranceEnd" || m.speech_final === true;
      const send = String(m.channel?.alternatives?.[0]?.transcript ?? "").includes("Marcinowi");
      if (closed && !send) { await r.rt.idle(); await until(() => !r.voice.speaking); }
    }
    await until(() => Object.keys(r.kernel.state.consents).length === 1);
    await until(() => !r.voice.speaking);
    speakInto(r.stt, "tak, wyślij", r.at);
    await r.rt.idle();
    expect(r.mail.sent).toHaveLength(1);
    expect(r.rt.turns.filter((t) => t.route === "action").every((t) => t.result?.truth === "CONFIRMED")).toBe(true);
    r.rt.stop();
  });

  it("barge-in: the user talking over JARVIS stops the audio in the same tick", async () => {
    const r = rig({ model: { reply: async () => "To jest bardzo długa odpowiedź. Ma kilka zdań. I jeszcze jedno." }, playMs: 0 });
    await r.rt.start();
    await r.voice.start();
    speakInto(r.stt, "opowiedz coś o Łodzi", r.at);
    await until(() => r.tts.spoken.length === 1);
    expect(r.voice.speaking).toBe(true);
    const before = r.tts.cancels;
    const id = speakInto(r.stt, "czekaj chwilę", r.at, { final: false });
    expect(r.tts.cancels).toBeGreaterThan(before); // synchronous, before any await
    expect(r.voice.speaking).toBe(false);
    expect(r.events.some((e) => e.type === "barge_in")).toBe(true);
    expect(r.tts.spoken).toEqual(["To jest bardzo długa odpowiedź."]); // the rest was never spoken
    expect(r.voice.latency.timeline(id)?.cancel).toBeDefined();
    r.rt.stop();
  });

  it("'stop' said during speech: audio cut and the running task cancelled", async () => {
    const r = rig({ playMs: 0 });
    await r.rt.start();
    await r.voice.start();
    speakInto(r.stt, "Jarvis, uruchom przeglądarkę.", r.at);
    await r.rt.idle();
    expect(r.voice.speaking).toBe(true); // "Już. Przeglądarka jest otwarta." still playing
    speakInto(r.stt, "Wejdź na YouTube.", r.at);
    speakInto(r.stt, "stop", r.at, { final: false });
    expect(r.voice.speaking).toBe(false);
    await r.rt.idle();
    const task = Object.values(r.kernel.state.tasks).find((t) => t.kind === "browser.gotoSite");
    expect(task?.status ?? "cancelled").toBe("cancelled");
    r.rt.stop();
  });

  it("our own voice coming back through the microphone is not a command and not a barge-in", async () => {
    const r = rig({ playMs: 0 });
    await r.rt.start();
    await r.voice.start();
    speakInto(r.stt, "Jarvis, uruchom przeglądarkę.", r.at);
    await r.rt.idle();
    await until(() => r.tts.spoken.length === 1);
    const turns = r.rt.turns.length;
    const cancels = r.tts.cancels;
    speakInto(r.stt, "już przeglądarka jest otwarta", r.at);
    expect(r.tts.cancels).toBe(cancels);
    expect(r.rt.turns.length).toBe(turns);
    expect(r.events.filter((e) => e.type === "echo_ignored").length).toBeGreaterThan(0);
    // A short user word that JARVIS did not just say is not echo.
    expect(r.voice.isEcho("stop")).toBe(false);
    expect(r.voice.isEcho("tak")).toBe(false);
    r.tts.finish();
    r.rt.stop();
  });

  it("a recognizer that repeats a final after a reconnect does not repeat the action", async () => {
    const r = rig();
    await r.rt.start();
    await r.voice.start();
    speakInto(r.stt, "Jarvis, uruchom przeglądarkę.", r.at, { id: "a" });
    speakInto(r.stt, "Jarvis, uruchom przeglądarkę.", r.at, { id: "a" }); // same id replayed
    speakInto(r.stt, "Jarvis, uruchom przeglądarkę.", r.at, { id: "b" }); // same text within 800 ms
    await r.rt.idle();
    expect(r.rt.turns.filter((t) => t.route === "action")).toHaveLength(1);
    expect(Object.values(r.kernel.state.actions).filter((a) => a.kind === "browser.launch")).toHaveLength(1);
    r.rt.stop();
  });

  it("wake word mode: without 'Jarvis' nothing happens, then a follow-up window, then closed again", async () => {
    const clock = { t: 1_000_000 };
    const r = rig({ mode: "wake", clock, playMs: 1 });
    await r.rt.start();
    await r.voice.start();
    speakInto(r.stt, "uruchom przeglądarkę", () => clock.t);
    expect(r.rt.turns).toHaveLength(0);
    expect(r.events.some((e) => e.type === "gated")).toBe(true);
    speakInto(r.stt, "Jarvis, uruchom przeglądarkę.", () => clock.t);
    await r.rt.idle();
    await until(() => !r.voice.speaking);
    clock.t += 2000;
    speakInto(r.stt, "Wejdź na YouTube.", () => clock.t); // follow-up, no wake word needed
    await r.rt.idle();
    await until(() => !r.voice.speaking);
    expect(r.rt.turns.filter((t) => t.route === "action")).toHaveLength(2);
    clock.t += 20_000;
    speakInto(r.stt, "Otwórz pierwszy film.", () => clock.t);
    expect(r.rt.turns.filter((t) => t.route === "action")).toHaveLength(2);
    r.rt.stop();
  });

  it("push-to-talk: only speech that began while the button was held reaches the runtime", async () => {
    const r = rig({ mode: "ptt" });
    await r.rt.start();
    await r.voice.start();
    speakInto(r.stt, "uruchom przeglądarkę", r.at);
    expect(r.rt.turns).toHaveLength(0);
    r.voice.setPushToTalk(true);
    const id = speakInto(r.stt, "uruchom", r.at, { final: false });
    r.voice.setPushToTalk(false); // released before the recognizer's final arrives
    r.stt.emit({ type: "final", utteranceId: id, text: "uruchom przeglądarkę", confidence: 0.9, at: r.at() });
    await r.rt.idle();
    expect(r.rt.turns.filter((t) => t.route === "action")).toHaveLength(1);
    r.rt.stop();
  });

  it("partials only speculate (reads): no task, action or consent before the final", async () => {
    const seen: string[] = [];
    const r = rig({ speculate: (t) => seen.push(t) });
    await r.rt.start();
    await r.voice.start();
    speakInto(r.stt, "Zaznacz pierwsze cztery litery", r.at, { final: false });
    speakInto(r.stt, "Wyślij to mailem Marcinowi", r.at, { final: false });
    await new Promise((res) => setTimeout(res, 20));
    expect(seen.length).toBeGreaterThan(4);
    expect(Object.keys(r.kernel.state.tasks)).toHaveLength(0);
    expect(Object.keys(r.kernel.state.actions)).toHaveLength(0);
    expect(Object.keys(r.kernel.state.consents)).toHaveLength(0);
    r.rt.stop();
  });

  it("default speculation resolves the target on partials but dispatches nothing", async () => {
    const r = rig();
    await r.rt.start();
    await r.voice.start();
    for (const t of ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "Zjedź trochę niżej.", "Znajdź komentarze."]) speakInto(r.stt, t, r.at);
    await r.rt.idle();
    const seq = r.kernel.state.seq;
    const tasks = Object.keys(r.kernel.state.tasks).length;
    speakInto(r.stt, "Pierwszy komentarz", r.at, { final: false });
    expect(r.voice.speculated).toMatchObject({ text: "Pierwszy komentarz", resolution: "resolved" });
    expect(Object.keys(r.kernel.state.tasks)).toHaveLength(tasks);
    // Only the partials themselves reached the kernel (SpeechPartial events).
    expect(r.kernel.state.seq - seq).toBe(2);
    r.rt.stop();
  });

  it("a slow action gets 'Sekunda.' from the clip cache, once, and then the real answer", async () => {
    const stt = new ScriptedSTT();
    const tts = new FakeTTS(1);
    const voice = new VoiceSession({ stt, tts, holdOnMs: 30 });
    const kernel = new Kernel();
    const rt = new JarvisRuntime({ kernel, env: new MemoryBrowser({ delays: { "browser.launch": 120 } }), speaker: voice, session: { youtubeUrl: "http://yt.test/" } });
    voice.attach(rt);
    await rt.start();
    await voice.start();
    speakInto(stt, "Jarvis, uruchom przeglądarkę.", () => Date.now());
    await rt.idle();
    await until(() => !voice.speaking);
    expect(tts.cached).toEqual(["Sekunda.", "Już."]);
    expect(tts.spoken).toEqual(["Przeglądarka jest otwarta."]);
    expect(tts.earcons).toContain("working");
    rt.stop();
  });

  it("short confirmations come from the pre-rendered clip cache, other text is synthesized sentence by sentence", async () => {
    const r = rig();
    await r.rt.start();
    await r.voice.start();
    expect(r.tts.prepared).toEqual(expect.arrayContaining(["Już.", "Mam.", "Sekunda.", "Nie znalazłem."]));
    r.voice.say("Już.");
    r.voice.say("Mam komentarze, widzę 8. Pierwszy jest przypięty.");
    await until(() => !r.voice.speaking);
    expect(r.tts.cached).toEqual(["Już."]);
    expect(r.tts.spoken).toEqual(["Mam komentarze, widzę 8.", "Pierwszy jest przypięty."]);
    expect(r.tts.earcons).toContain("listening");
    r.rt.stop();
  });

  it("a sentence the synthesizer fails on is skipped, the rest is still spoken", async () => {
    const stt = new ScriptedSTT();
    const tts = new FakeTTS(1);
    const speak = tts.speak.bind(tts);
    tts.speak = (t, h) => (t.startsWith("Zepsute") ? Promise.reject(new Error("tts down")) : speak(t, h));
    const voice = new VoiceSession({ stt, tts, cachedPhrases: [] });
    voice.say("Zepsute zdanie. Drugie zdanie.");
    await until(() => !voice.speaking);
    expect(tts.spoken).toEqual(["Drugie zdanie."]);
    expect(tts.earcons).toContain("error");
  });

  it("splits sentences on Polish punctuation without losing text", () => {
    expect(sentences("Już. Mam komentarze! Co dalej? Nic…")).toEqual(["Już.", "Mam komentarze!", "Co dalej?", "Nic…"]);
    expect(sentences("bez kropki")).toEqual(["bez kropki"]);
  });
});
