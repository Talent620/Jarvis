// Browser side of the voice session (mission 5.14): microphone with echo cancellation in the
// same renderer that plays TTS, PCM16 16 kHz framing for streaming recognizers, WAV for the
// batch Whisper fallback, and the app's existing speech output as a StreamingTTS. The pure
// helpers are tested; the microphone itself needs hardware (acceptance, M6).

import type { StreamingTTS } from "./types";

export const TARGET_RATE = 16_000;

/** Microphone constraints for voice control: the browser's echo canceller removes our own TTS. */
export function voiceMicConstraints(): MediaTrackConstraints {
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
}

/** Float samples at `inRate` to PCM16 at 16 kHz (linear interpolation when resampling). */
export function floatToPcm16(input: Float32Array, inRate: number, outRate = TARGET_RATE): Int16Array {
  const ratio = inRate / outRate;
  const n = ratio === 1 ? input.length : Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = input[j] ?? 0;
    const b = input[Math.min(j + 1, input.length - 1)] ?? a;
    const v = Math.max(-1, Math.min(1, a + (b - a) * frac));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}

/** PCM16 mono frames to a WAV file (for the batch recognizer). */
export function pcm16ToWav(frames: ArrayBuffer[], rate = TARGET_RATE): ArrayBuffer {
  const bytes = frames.reduce((n, f) => n + f.byteLength, 0);
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + bytes, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, bytes, true);
  let o = 44;
  for (const f of frames) { new Uint8Array(buf, o, f.byteLength).set(new Uint8Array(f)); o += f.byteLength; }
  return buf;
}

/** Microphone to 20-32 ms PCM16 frames. */
export class MicInput {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  constructor(private readonly constraints: () => MediaStreamConstraints["audio"] = () => voiceMicConstraints()) {}

  async start(onFrame: (frame: ArrayBuffer) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: this.constraints() });
    const Ctx = (window as unknown as { AudioContext: typeof AudioContext }).AudioContext;
    this.ctx = new Ctx({ sampleRate: TARGET_RATE });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(512, 1, 1);
    const rate = this.ctx.sampleRate;
    this.node.onaudioprocess = (ev) => onFrame(floatToPcm16(ev.inputBuffer.getChannelData(0), rate).buffer as ArrayBuffer);
    src.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  async stop(): Promise<void> {
    try { this.node?.disconnect(); } catch { /* already gone */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => undefined);
    this.node = null;
    this.stream = null;
    this.ctx = null;
  }
}

/**
 * The app's speech output (system, Gemini, ElevenLabs, local) as a StreamingTTS. First audio is
 * approximated by the start of playback; exact timing needs the audio element (acceptance).
 */
export class AppTTS implements StreamingTTS {
  readonly id = "app-tts";
  constructor(private readonly io: { speak: (text: string) => Promise<void>; stop: () => void; earcon?: (kind: string) => void }) {}
  async speak(text: string, hooks?: { onFirstAudio?: () => void }): Promise<void> {
    hooks?.onFirstAudio?.();
    await this.io.speak(text);
  }
  cancel(): void {
    this.io.stop();
  }
  earcon(kind: "listening" | "working" | "done" | "error"): void {
    this.io.earcon?.(kind);
  }
}
