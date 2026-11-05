// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Listener } from "../src/lib/voice";

class Recognition {
  static instances: Recognition[] = [];
  lang = ""; continuous = false; interimResults = false;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { Recognition.instances.push(this); }
}
afterEach(() => { Recognition.instances.length = 0; vi.unstubAllGlobals(); });
const result = (text: string) => ({ resultIndex: 0, results: Object.assign([[{ transcript: text }]], { 0: Object.assign([{ transcript: text }], { isFinal: true }) }) });

describe("Web Speech lifecycle", () => {
  it("reports start only after recognition starts and ignores results after stop or replacement", () => {
    vi.stubGlobal("SpeechRecognition", Recognition);
    const onStart = vi.fn(); const onFinal = vi.fn();
    const listener = new Listener({ onStart, onFinal });
    listener.start(); const first = Recognition.instances[0];
    expect(onStart).not.toHaveBeenCalled(); first.onstart?.(); expect(onStart).toHaveBeenCalledOnce();
    listener.stop(); first.onresult?.(result("spóźnione"));
    listener.start(); const second = Recognition.instances[1];
    first.onstart?.(); first.onresult?.(result("stary wynik"));
    expect(onStart).toHaveBeenCalledOnce(); expect(onFinal).not.toHaveBeenCalled();
    second.onstart?.(); second.onresult?.(result("nowy wynik"));
    expect(onStart).toHaveBeenCalledTimes(2); expect(onFinal).toHaveBeenCalledWith("nowy wynik");
    listener.stop();
  });
  it("reports a synchronous recognition startup failure", () => {
    vi.stubGlobal("SpeechRecognition", class extends Recognition { constructor() { super(); this.start = vi.fn(() => { throw new Error("unavailable"); }); } });
    const onError = vi.fn(); const onEnd = vi.fn(); const onStart = vi.fn();
    const listener = new Listener({ onFinal: vi.fn(), onError, onEnd, onStart });
    listener.start();
    expect(onError).toHaveBeenCalledOnce(); expect(onEnd).toHaveBeenCalledOnce();
    expect(onStart).not.toHaveBeenCalled(); expect(listener.listening).toBe(false);
  });
  it("reports denied microphone permission and stops listening", () => {
    vi.stubGlobal("SpeechRecognition", Recognition);
    const onError = vi.fn(); const listener = new Listener({ onFinal: vi.fn(), onError });
    listener.start(); Recognition.instances[0].onerror?.({ error: "not-allowed" });
    expect(onError).toHaveBeenCalledOnce(); expect(listener.listening).toBe(false);
  });
});
