// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
const listenerMock = vi.hoisted(() => ({ calls: 0, callbacks: null as null | { onError: (text: string) => void; onEnd: () => void }, stop: vi.fn() }));
vi.mock("../src/lib/voice", () => ({
  createListener: (callbacks: typeof listenerMock.callbacks) => { listenerMock.calls++; listenerMock.callbacks = callbacks; return { start: () => {}, stop: listenerMock.stop, listening: false }; },
  speak: async () => {}, stopSpeaking: () => {}, isSpeechSupported: () => true,
}));
vi.mock("../src/lib/brain", () => ({ askJarvis: async () => ({ text: "OK" }) }));
vi.mock("../src/lib/store", () => ({ store: { settings: { speak: true } } }));
import { ConversationLoop } from "../src/lib/voiceLoop";
afterEach(() => { vi.useRealTimers(); listenerMock.calls = 0; listenerMock.callbacks = null; listenerMock.stop.mockClear(); });

describe("voice loop microphone failure", () => {
  it("stops after denied permission and resumes only after explicit start", () => {
    vi.useFakeTimers(); const states: string[] = [];
    const loop = new ConversationLoop((state) => states.push(state), () => {});
    loop.start(); expect(listenerMock.calls).toBe(1);
    listenerMock.callbacks?.onError("Brak zgody na mikrofon");
    listenerMock.callbacks?.onEnd(); vi.advanceTimersByTime(5000);
    expect(listenerMock.calls).toBe(1); expect(listenerMock.stop).toHaveBeenCalledOnce();
    expect(states.filter((state) => state === "error")).toHaveLength(1);
    loop.start(); expect(listenerMock.calls).toBe(2); loop.stop();
  });
  it("restarts after a normal end while listening remains enabled", () => {
    vi.useFakeTimers(); const loop = new ConversationLoop(() => {}, () => {});
    loop.start(); listenerMock.callbacks?.onEnd(); vi.advanceTimersByTime(300);
    expect(listenerMock.calls).toBe(2); loop.stop(); vi.advanceTimersByTime(5000); expect(listenerMock.calls).toBe(2);
  });
});
