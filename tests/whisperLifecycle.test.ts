// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/voice", () => ({ isSpeaking: () => false }));
vi.mock("../src/lib/transcribe", () => ({ transcribeAudio: vi.fn() }));
vi.mock("../src/lib/keys", () => ({ primaryKey: () => "" }));
vi.mock("../src/lib/store", () => ({ store: { settings: { localStt: true } } }));
vi.mock("../src/lib/audioLevel", () => ({ setLevel: vi.fn() }));
vi.mock("../src/lib/mic", () => ({ micAudioConstraints: () => ({}) }));
import { WhisperListener } from "../src/lib/whisperListener";
import { transcribeAudio } from "../src/lib/transcribe";

const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const stream = () => { const stop = vi.fn(); return { stop, value: { getTracks: () => [{ stop }] } as unknown as MediaStream }; };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
let close: ReturnType<typeof vi.fn>;
let interval: ReturnType<typeof vi.spyOn>;
class FakeRecorder {
  static isTypeSupported() { return true; }
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {}
  stop() { this.ondataavailable?.({ data: new Blob(["a".repeat(1400)]) }); this.onstop?.(); }
}
class FakeContext {
  createMediaStreamSource() { return { connect: () => {} }; }
  createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData: (data: Float32Array) => data.fill(0.2) }; }
  close() { close(); return Promise.resolve(); }
}
beforeEach(() => {
  vi.useFakeTimers();
  close = vi.fn();
  interval = vi.spyOn(window, "setInterval");
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("microphone lifecycle", () => {
  it("stops a permission result that arrives after cancellation without opening audio", async () => {
    const request = deferred<MediaStream>(); const mic = stream(); const onStart = vi.fn(); const onEnd = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(() => request.promise) } });
    const listener = new WhisperListener({ onFinal: vi.fn(), onStart, onEnd });
    listener.start(); listener.stop(); request.resolve(mic.value); await settle();
    expect(mic.stop).toHaveBeenCalledOnce(); expect(listener.listening).toBe(false);
    expect(onStart).not.toHaveBeenCalled(); expect(onEnd).not.toHaveBeenCalled(); expect(interval).not.toHaveBeenCalled();
  });
  it("keeps the newest start when permission requests resolve in reverse order", async () => {
    const first = deferred<MediaStream>(); const second = deferred<MediaStream>(); const oldMic = stream(); const newMic = stream(); const onStart = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) } });
    const listener = new WhisperListener({ onFinal: vi.fn(), onStart });
    listener.start(); listener.stop(); listener.start(); second.resolve(newMic.value); await settle();
    first.resolve(oldMic.value); await settle();
    expect(oldMic.stop).toHaveBeenCalledOnce(); expect(newMic.stop).not.toHaveBeenCalled();
    expect(listener.listening).toBe(true); expect(onStart).toHaveBeenCalledOnce();
    listener.stop(); expect(newMic.stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it("cleans up an acquired stream and reports an audio setup failure", async () => {
    const mic = stream(); const onError = vi.fn(); const onEnd = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(mic.value) } });
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("audio device failed"); } });
    const listener = new WhisperListener({ onFinal: vi.fn(), onStart: vi.fn(), onError, onEnd });
    listener.start(); await settle();
    expect(mic.stop).toHaveBeenCalledOnce(); expect(listener.listening).toBe(false);
    expect(onError).toHaveBeenCalledOnce(); expect(onEnd).toHaveBeenCalledOnce(); expect(interval).not.toHaveBeenCalled();
  });
  it("does not transcribe a recording closed by Stop", async () => {
    const mic = stream(); vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(mic.value) } });
    const listener = new WhisperListener({ onFinal: vi.fn() });
    listener.start(); await settle(); vi.advanceTimersByTime(400); listener.stop(); await settle();
    expect(transcribeAudio).not.toHaveBeenCalled(); expect(mic.stop).toHaveBeenCalledOnce();
  });
});
