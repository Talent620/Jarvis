// Pure parts of the browser audio layer: echo-cancelling microphone constraints, PCM16 16 kHz
// conversion, WAV for the batch recognizer, and the app TTS adapter.
import { describe, it, expect } from "vitest";
import { AppTTS, floatToPcm16, pcm16ToWav, voiceMicConstraints } from "../../src/lib/runtime/voice/browserAudio";

describe("browser audio for voice control", () => {
  it("the microphone asks for echo cancellation (TTS plays in the same renderer)", () => {
    expect(voiceMicConstraints()).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 });
  });

  it("48 kHz float audio becomes 16 kHz PCM16, clipped to range", () => {
    const input = new Float32Array(4800).map((_, i) => Math.sin(i / 10) * 1.5);
    const out = floatToPcm16(input, 48_000);
    expect(out.length).toBe(1600);
    expect(Math.max(...out)).toBe(32767);
    expect(Math.min(...out)).toBe(-32768);
    expect(floatToPcm16(new Float32Array([0, 0.5, -0.5]), 16_000)).toEqual(new Int16Array([0, 16384, -16384]));
  });

  it("WAV header describes 16 kHz mono PCM16 and carries every frame", () => {
    const a = new Int16Array([1, 2]).buffer;
    const b = new Int16Array([3]).buffer;
    const wav = new DataView(pcm16ToWav([a, b]));
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(wav.buffer, o, 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(wav.getUint32(24, true)).toBe(16000);
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(40, true)).toBe(6);
    expect(new Int16Array(wav.buffer, 44, 3)).toEqual(new Int16Array([1, 2, 3]));
  });

  it("the app TTS adapter speaks through the app and stops at once", async () => {
    const log: string[] = [];
    const tts = new AppTTS({ speak: async (t) => { log.push(`say ${t}`); }, stop: () => log.push("stop") });
    let first = false;
    await tts.speak("Już.", { onFirstAudio: () => { first = true; } });
    tts.cancel();
    expect(first).toBe(true);
    expect(log).toEqual(["say Już.", "stop"]);
  });
});
