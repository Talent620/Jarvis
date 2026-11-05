// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../src/types";

const config = vi.hoisted(() => ({ geminiKey: "" }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "web", isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));
vi.mock("../src/lib/keys", () => ({ primaryKey: () => config.geminiKey }));
vi.mock("../src/lib/http", () => ({ fetchTimeout: vi.fn() }));
vi.mock("../src/lib/localTts", () => ({ localTtsUsable: () => false, synthLocal: vi.fn() }));
vi.mock("../src/lib/whisperListener", () => ({ WhisperListener: class {} }));

import { fetchTimeout } from "../src/lib/http";
import { isPlaybackActive, isSpeaking, speak, speakLang, stopSpeaking, subscribeSpeaking } from "../src/lib/voice";

class FakeUtterance {
  onstart: (() => void) | null = null;
  onresume: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

class FakeAudio {
  static all: FakeAudio[] = [];
  static failPlay = false;
  onplaying: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  ended = false;
  constructor(public src: string) { FakeAudio.all.push(this); }
  play() {
    if (FakeAudio.failPlay) return Promise.reject(new Error("output unavailable"));
    this.paused = false;
    this.onplaying?.();
    return Promise.resolve();
  }
  pause() { this.paused = true; this.onpause?.(); }
}

const system = { speak: true, voiceMode: "system", voiceRate: 1, voicePitch: 1 } as Settings;
const premium = { ...system, voiceMode: "fish", fishAudioApiKey: "test", fishAudioVoiceId: "test" } as Settings;
let utterances: FakeUtterance[] = [];
const subscriptions: (() => void)[] = [];

function observe(): boolean[] {
  const states: boolean[] = [];
  subscriptions.push(subscribeSpeaking((active) => states.push(active)));
  return states;
}

beforeEach(() => {
  utterances = [];
  FakeAudio.all = [];
  FakeAudio.failPlay = false;
  config.geminiKey = "";
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => [{ name: "Test PL", lang: "pl-PL" }],
    resume: vi.fn(), cancel: vi.fn(),
    speak: (u: FakeUtterance) => utterances.push(u),
  });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
  vi.mocked(fetchTimeout).mockReset();
  vi.mocked(fetchTimeout).mockResolvedValue({ ok: true, blob: async () => new Blob(["audio"]) } as Response);
  stopSpeaking();
});

afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  stopSpeaking();
  vi.unstubAllGlobals();
});

describe("TTS playback lifecycle for visual state and echo suppression", () => {
  it("publishes the immediate snapshot, then system start/end without changing speak() timing", async () => {
    const states = observe();
    await speak("Witaj", system);
    expect(states).toEqual([false]);
    expect(isSpeaking()).toBe(true); // queued speech still guards the microphone
    utterances[0].onstart?.();
    expect(isPlaybackActive()).toBe(true);
    utterances[0].onend?.();
    expect(states).toEqual([false, true, false]);
    expect(isSpeaking()).toBe(false);
  });

  it("uses system pause/resume and error events", async () => {
    const states = observe();
    await speak("Witaj", system);
    const u = utterances[0];
    u.onstart?.(); u.onpause?.(); u.onresume?.(); u.onerror?.();
    expect(states).toEqual([false, true, false, true, false]);
    expect(isSpeaking()).toBe(false);
  });

  it("keeps real audio active after speak resolves and clears it on ended", async () => {
    const states = observe();
    await speak("Witaj", premium);
    expect(isPlaybackActive()).toBe(true);
    expect(isSpeaking()).toBe(true);
    FakeAudio.all[0].onended?.();
    expect(states).toEqual([false, true, false]);
    expect(isSpeaking()).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("stops audio immediately and ignores stale playback/end events after replacement", async () => {
    const states = observe();
    await speak("Pierwszy", premium);
    const old = FakeAudio.all[0];
    const oldEnd = old.onended;
    const oldStart = old.onplaying;
    await speak("Drugi", premium);
    oldEnd?.(); oldStart?.();
    expect(old.paused).toBe(true);
    expect(isPlaybackActive()).toBe(true);
    stopSpeaking();
    expect(states).toEqual([false, true, false, true, false]);
    expect(isSpeaking()).toBe(false);
  });

  it("ignores canceled system callbacks while a newer utterance speaks", async () => {
    await speak("Pierwszy", system);
    const old = utterances[0];
    const oldEnd = old.onend;
    const oldStart = old.onstart;
    old.onstart?.();
    await speak("Drugi", system);
    utterances[1].onstart?.();
    oldEnd?.(); oldStart?.();
    expect(isPlaybackActive()).toBe(true);
    expect(isSpeaking()).toBe(true);
    utterances[1].onend?.();
    expect(isSpeaking()).toBe(false);
  });

  it("cleans audio failures without showing output that never started", async () => {
    FakeAudio.failPlay = true;
    const states = observe();
    await speak("Witaj", premium);
    expect(states).toEqual([false]);
    expect(isSpeaking()).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("clears a real output error after playback has started", async () => {
    const states = observe();
    await speak("Witaj", premium);
    FakeAudio.all[0].onerror?.();
    expect(states).toEqual([false, true, false]);
    expect(isSpeaking()).toBe(false);
  });

  it("continues Gemini chunks after the browser's natural pause-before-ended event", async () => {
    config.geminiKey = "test";
    vi.mocked(fetchTimeout).mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAAAA==", mimeType: "audio/pcm;rate=24000" } }] } }] }) } as Response);
    const states = observe();
    const pending = speak("Pierwsza część ma sporo tekstu i musi wypełnić swój fragment. ".repeat(5), { ...system, voiceMode: "gemini" });
    await vi.waitFor(() => expect(FakeAudio.all).toHaveLength(1));
    expect(isSpeaking()).toBe(true);
    FakeAudio.all[0].ended = true;
    FakeAudio.all[0].onpause?.();
    await vi.waitFor(() => expect(FakeAudio.all).toHaveLength(2));
    FakeAudio.all[1].onended?.();
    await pending;
    expect(states).toEqual([false, true, false, true, false]);
    expect(isSpeaking()).toBe(false); // parent and stream guards must both release
  });

  it("releases Gemini output and its preparation guard when stopped", async () => {
    config.geminiKey = "test";
    vi.mocked(fetchTimeout).mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAAAA==" } }] } }] }) } as Response);
    const pending = speak("Krótka odpowiedź.", { ...system, voiceMode: "gemini" });
    await vi.waitFor(() => expect(isPlaybackActive()).toBe(true));
    stopSpeaking();
    await pending;
    expect(isPlaybackActive()).toBe(false);
    expect(isSpeaking()).toBe(false);
  });

  it("does not restart canceled speech when the audio body arrives late", async () => {
    let finishBlob!: (blob: Blob) => void;
    vi.mocked(fetchTimeout).mockResolvedValue({ ok: true, blob: () => new Promise<Blob>((resolve) => { finishBlob = resolve; }) } as Response);
    const pending = speak("Spóźniony", premium);
    await Promise.resolve();
    stopSpeaking();
    finishBlob(new Blob(["audio"]));
    await pending;
    expect(FakeAudio.all).toHaveLength(0);
    expect(isSpeaking()).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("also tracks translator speech and isolates failing subscribers", async () => {
    subscriptions.push(subscribeSpeaking(() => { throw new Error("render error"); }));
    const states = observe();
    await speakLang("Hello", "en-GB", { premium: false });
    utterances[0].onstart?.();
    const late = observe();
    expect(late).toEqual([true]);
    utterances[0].onend?.();
    expect(states).toEqual([false, true, false]);
  });

  it("unsubscribes observers cleanly", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSpeaking(listener);
    unsubscribe();
    await speak("Witaj", system);
    utterances[0].onstart?.();
    utterances[0].onend?.();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
