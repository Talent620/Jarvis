// Test doubles for the voice session: a TTS whose audio can be cancelled at once, a recognizer
// driven by scripted events, and a socket that replays provider protocol messages.
import type { Connect, SocketLike, StreamingSTT, StreamingTTS, SttEvent } from "../../src/lib/runtime/voice/types";

export class FakeTTS implements StreamingTTS {
  readonly id = "fake-tts";
  spoken: string[] = [];
  cached: string[] = [];
  cancels = 0;
  prepared: string[] = [];
  earcons: string[] = [];
  private pending: (() => void) | null = null;
  /** Milliseconds each sentence "plays"; 0 = until cancelled or released. */
  constructor(private readonly playMs = 5) {}
  async prepare(texts: string[]) { this.prepared.push(...texts); }
  earcon(kind: string) { this.earcons.push(kind); }
  speak(text: string, hooks?: { onFirstAudio?: () => void }): Promise<void> {
    this.spoken.push(text);
    queueMicrotask(() => hooks?.onFirstAudio?.());
    return new Promise((resolve) => {
      const done = () => { if (this.pending === done) this.pending = null; resolve(); };
      this.pending = done;
      if (this.playMs > 0) setTimeout(done, this.playMs);
    });
  }
  playCached(text: string, hooks?: { onFirstAudio?: () => void }): boolean {
    if (!this.prepared.includes(text)) return false;
    this.cached.push(text);
    hooks?.onFirstAudio?.();
    return true;
  }
  cancel() { this.cancels++; this.pending?.(); }
  /** Finish the sentence that is playing now (for playMs = 0). */
  finish() { this.pending?.(); }
}

export class ScriptedSTT implements StreamingSTT {
  emit: (e: SttEvent) => void = () => undefined;
  frames = 0;
  started = false;
  stopped = false;
  constructor(readonly id = "scripted-stt", private readonly failOnStart = false) {}
  async start(onEvent: (e: SttEvent) => void) {
    if (this.failOnStart) throw new Error(`${this.id} unavailable`);
    this.emit = onEvent; this.started = true;
  }
  pushAudio() { this.frames++; }
  async stop() { this.stopped = true; }
}

let n = 0;
/** Emit the partials a streaming recognizer would produce for `text`, then the final. */
export function speakInto(stt: ScriptedSTT, text: string, at: () => number, opts: { final?: boolean; id?: string } = {}): string {
  const id = opts.id ?? `utt-${++n}`;
  const words = text.split(" ");
  stt.emit({ type: "speech_start", at: at() });
  for (let i = 1; i <= words.length; i++) {
    stt.emit({ type: "partial", utteranceId: id, text: words.slice(0, i).join(" "), stability: i === words.length ? 0.9 : 0.5, at: at() });
  }
  if (opts.final !== false) {
    stt.emit({ type: "final", utteranceId: id, text, confidence: 0.92, at: at() });
    stt.emit({ type: "speech_end", at: at() });
  }
  return id;
}

/** A socket that records what is sent and lets the test deliver server messages. */
export class FakeSocket implements SocketLike {
  readyState = 0;
  sent: (string | ArrayBuffer)[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  constructor(readonly url: string, readonly protocols?: string[]) {}
  open() { this.readyState = 1; this.onopen?.({}); }
  deliver(msg: unknown) { this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) }); }
  send(data: string | ArrayBuffer) { this.sent.push(data); }
  close(code?: number, reason?: string) { this.readyState = 3; this.closed = { code, reason }; }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

export function fakeConnect(): { connect: Connect; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  return { sockets, connect: (url, protocols) => { const s = new FakeSocket(url, protocols); sockets.push(s); return s; } };
}
