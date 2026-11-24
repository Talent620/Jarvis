import { describe, it, expect, vi } from "vitest";
import { BargeInController, normalizeModalVoiceUrl } from "../src/lib/modalVoice";

describe("normalizeModalVoiceUrl", () => {
  it("normalizuje bazowy URL Modal Voice i usuwa sufiksy /v1/*", () => {
    expect(normalizeModalVoiceUrl("https://u--jarvis-voice-web.modal.run/")).toBe("https://u--jarvis-voice-web.modal.run");
    expect(normalizeModalVoiceUrl("https://u--jarvis-voice-web.modal.run/v1/tts")).toBe("https://u--jarvis-voice-web.modal.run");
    expect(normalizeModalVoiceUrl("u--jarvis-voice-web.modal.run")).toBe("https://u--jarvis-voice-web.modal.run");
    expect(normalizeModalVoiceUrl("")).toBe("");
  });
});

describe("BargeInController — full-duplex przerywanie wypowiedzi", () => {
  it("ignoruje energię mikrofonu, gdy JARVIS nie mówi", () => {
    const onInterrupt = vi.fn();
    const ctrl = new BargeInController({ threshold: 0.1, minFrames: 2, onInterrupt });
    expect(ctrl.feedMicLevel(0.5)).toBe(false);
    expect(ctrl.feedMicLevel(0.5)).toBe(false);
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it("wymaga kolejnych ramek powyżej progu (chroni przed pojedynczym trzaskiem)", () => {
    const onInterrupt = vi.fn();
    const ctrl = new BargeInController({ threshold: 0.1, minFrames: 3, onInterrupt });
    const sig = ctrl.beginSpeaking();
    expect(ctrl.feedMicLevel(0.2)).toBe(false);
    expect(ctrl.feedMicLevel(0.2)).toBe(false);
    expect(ctrl.feedMicLevel(0.02)).toBe(false); // spadek resetuje licznik
    expect(ctrl.feedMicLevel(0.2)).toBe(false);
    expect(sig.aborted).toBe(false);
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it("przerywa AbortSignal i wywołuje onInterrupt po serii ramek mowy", () => {
    const onInterrupt = vi.fn();
    const ctrl = new BargeInController({ threshold: 0.08, minFrames: 2, onInterrupt });
    const sig = ctrl.beginSpeaking();
    expect(ctrl.feedMicLevel(0.15)).toBe(false);
    expect(ctrl.feedMicLevel(0.18)).toBe(true);
    expect(sig.aborted).toBe(true);
    expect(ctrl.isSpeaking()).toBe(false);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });
});
