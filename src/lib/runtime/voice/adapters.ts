// Streaming STT adapters (mission 5.14): two streaming recognizers with Polish (Deepgram live,
// OpenAI Realtime transcription) and the batch Whisper path as fallback, plus a fallback chain.
// Each protocol is a pure parser (message in, SttEvent out) so recorded streams replay in tests
// without a socket; the classes only add the socket and audio framing.

import type { Connect, SocketLike, StreamingSTT, SttEvent } from "./types";

type Emit = (e: SttEvent) => void;

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

const OPEN = 1;
const MAX_BUFFERED_FRAMES = 250; // ~5 s of 20 ms frames while the socket opens

function parseJson(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  try {
    const v = JSON.parse(data);
    return v && typeof v === "object" ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ Deepgram live (nova-3)

/**
 * Deepgram live results: interim results grow the current utterance, `is_final` commits a
 * segment, `speech_final` or `UtteranceEnd` closes the utterance (one final per utterance).
 */
export function deepgramParser(emit: Emit, now: () => number, newId: () => string = () => nextId("dg")): (msg: Record<string, unknown>) => void {
  let utteranceId = newId();
  let committed: string[] = [];
  let confidences: number[] = [];
  const close = () => {
    const text = committed.join(" ").trim();
    if (text) {
      const confidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0.8;
      emit({ type: "final", utteranceId, text, confidence, at: now() });
      emit({ type: "speech_end", at: now() });
    }
    utteranceId = newId();
    committed = [];
    confidences = [];
  };
  return (msg) => {
    const type = msg.type;
    if (type === "SpeechStarted") { emit({ type: "speech_start", at: now() }); return; }
    if (type === "UtteranceEnd") { close(); return; }
    if (type !== "Results") return;
    const channel = msg.channel as { alternatives?: { transcript?: string; confidence?: number }[] } | undefined;
    const alt = channel?.alternatives?.[0];
    const text = String(alt?.transcript ?? "").trim();
    if (msg.is_final === true) {
      if (text) {
        committed.push(text);
        confidences.push(typeof alt?.confidence === "number" ? alt.confidence : 0.8);
        emit({ type: "partial", utteranceId, text: committed.join(" "), stability: 0.9, at: now() });
      }
      if (msg.speech_final === true) close();
    } else if (text) {
      emit({ type: "partial", utteranceId, text: [...committed, text].join(" "), stability: 0.5, at: now() });
    }
  };
}

export interface DeepgramOptions {
  connect: Connect;
  /** Deepgram browser auth: the ["token", key] subprotocol pair, supplied by the caller. */
  protocols: string[];
  model?: string;
  language?: string;
  now?: () => number;
}

abstract class SocketSTT implements StreamingSTT {
  abstract readonly id: string;
  protected socket: SocketLike | null = null;
  protected emit: Emit = () => undefined;
  private pending: ArrayBuffer[] = [];
  private stopping = false;
  protected abstract url(): string;
  protected abstract protocols(): string[] | undefined;
  protected abstract onOpen(): void;
  protected abstract onMessage(msg: Record<string, unknown>): void;
  protected abstract encode(frame: ArrayBuffer): string | ArrayBuffer;
  protected abstract closeMessage(): string | null;
  constructor(private readonly connect: Connect, protected readonly now: () => number) {}

  async start(onEvent: Emit): Promise<void> {
    this.emit = onEvent;
    this.stopping = false;
    const s = this.connect(this.url(), this.protocols());
    this.socket = s;
    s.onopen = () => {
      this.onOpen();
      for (const f of this.pending.splice(0)) s.send(this.encode(f));
    };
    s.onmessage = (ev) => { const m = parseJson(ev.data); if (m) this.onMessage(m); };
    s.onerror = () => { if (!this.stopping) this.emit({ type: "error", error: `${this.id}: socket error`, fatal: true, at: this.now() }); };
    s.onclose = (ev) => {
      if (!this.stopping) this.emit({ type: "error", error: `${this.id}: closed (${ev?.code ?? "?"})`, fatal: true, at: this.now() });
    };
  }

  pushAudio(frame: ArrayBuffer): void {
    const s = this.socket;
    if (s && s.readyState === OPEN) s.send(this.encode(frame));
    else if (this.pending.length < MAX_BUFFERED_FRAMES) this.pending.push(frame);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const s = this.socket;
    this.socket = null;
    this.pending = [];
    if (!s) return;
    const bye = this.closeMessage();
    try { if (bye && s.readyState === OPEN) s.send(bye); } catch { /* closing anyway */ }
    try { s.close(1000, "stop"); } catch { /* already closed */ }
  }
}

export class DeepgramSTT extends SocketSTT {
  readonly id = "deepgram-nova-3";
  private parse: (m: Record<string, unknown>) => void = () => undefined;
  constructor(private readonly o: DeepgramOptions) {
    super(o.connect, o.now ?? (() => Date.now()));
  }
  protected url(): string {
    const q = new URLSearchParams({
      model: this.o.model ?? "nova-3", language: this.o.language ?? "pl", encoding: "linear16", sample_rate: "16000",
      channels: "1", interim_results: "true", vad_events: "true", endpointing: "300", utterance_end_ms: "1000",
      smart_format: "true", punctuate: "true",
    });
    return `wss://api.deepgram.com/v1/listen?${q.toString()}`;
  }
  protected protocols(): string[] { return this.o.protocols; }
  protected onOpen(): void { this.parse = deepgramParser(this.emit, this.now); }
  protected onMessage(m: Record<string, unknown>): void { this.parse(m); }
  protected encode(frame: ArrayBuffer): ArrayBuffer { return frame; }
  protected closeMessage(): string { return JSON.stringify({ type: "CloseStream" }); }
}

// ------------------------------------------------------------------ OpenAI Realtime transcription

/** Realtime transcription events: deltas per item grow the partial, `completed` is the final. */
export function openAiRealtimeParser(emit: Emit, now: () => number): (msg: Record<string, unknown>) => void {
  const text = new Map<string, string>();
  return (msg) => {
    const type = String(msg.type ?? "");
    const item = String(msg.item_id ?? "");
    if (type === "input_audio_buffer.speech_started") emit({ type: "speech_start", at: now() });
    else if (type === "input_audio_buffer.speech_stopped") emit({ type: "speech_end", at: now() });
    else if (type === "conversation.item.input_audio_transcription.delta" && item) {
      const t = (text.get(item) ?? "") + String(msg.delta ?? "");
      text.set(item, t);
      if (t.trim()) emit({ type: "partial", utteranceId: `oa-${item}`, text: t.trim(), stability: 0.6, at: now() });
    } else if (type === "conversation.item.input_audio_transcription.completed" && item) {
      const t = String(msg.transcript ?? text.get(item) ?? "").trim();
      text.delete(item);
      if (t) emit({ type: "final", utteranceId: `oa-${item}`, text: t, confidence: 0.85, at: now() });
    } else if (type === "error") {
      const err = msg.error as { message?: string; code?: string } | undefined;
      emit({ type: "error", error: `openai-realtime: ${err?.message ?? err?.code ?? "error"}`, fatal: false, at: now() });
    }
  };
}

export interface OpenAiRealtimeOptions {
  connect: Connect;
  /** Auth subprotocols for an ephemeral client secret, supplied by the caller. */
  protocols: string[];
  model?: string;
  language?: string;
  now?: () => number;
}

function base64(frame: ArrayBuffer): string {
  const bytes = new Uint8Array(frame);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
}

export class OpenAiRealtimeSTT extends SocketSTT {
  readonly id = "openai-realtime-transcribe";
  private parse: (m: Record<string, unknown>) => void = () => undefined;
  constructor(private readonly o: OpenAiRealtimeOptions) {
    super(o.connect, o.now ?? (() => Date.now()));
  }
  protected url(): string { return "wss://api.openai.com/v1/realtime?intent=transcription"; }
  protected protocols(): string[] { return this.o.protocols; }
  protected onOpen(): void {
    this.parse = openAiRealtimeParser(this.emit, this.now);
    this.socket?.send(JSON.stringify({
      type: "transcription_session.update",
      session: {
        input_audio_format: "pcm16",
        input_audio_transcription: { model: this.o.model ?? "gpt-4o-transcribe", language: this.o.language ?? "pl" },
        turn_detection: { type: "server_vad", silence_duration_ms: 500 },
      },
    }));
  }
  protected onMessage(m: Record<string, unknown>): void { this.parse(m); }
  protected encode(frame: ArrayBuffer): string { return JSON.stringify({ type: "input_audio_buffer.append", audio: base64(frame) }); }
  protected closeMessage(): null { return null; }
}

// ------------------------------------------------------------------ batch fallback (Whisper)

/** Energy-based turn detector on PCM16 frames: speech after `minSpeechMs`, end after `silenceMs`. */
export class TurnDetector {
  private speechMs = 0;
  private silenceMs = 0;
  private inSpeech = false;
  constructor(private readonly o: { frameMs?: number; threshold?: number; minSpeechMs?: number; silenceMs?: number } = {}) {}
  /** "start" / "end" at a turn boundary, otherwise null. */
  push(frame: ArrayBuffer): "start" | "end" | null {
    const pcm = new Int16Array(frame);
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2;
    const rms = pcm.length ? Math.sqrt(sum / pcm.length) : 0;
    const ms = this.o.frameMs ?? 20;
    const loud = rms >= (this.o.threshold ?? 0.02);
    if (loud) { this.speechMs += ms; this.silenceMs = 0; } else { this.silenceMs += ms; if (!this.inSpeech) this.speechMs = 0; }
    if (!this.inSpeech && this.speechMs >= (this.o.minSpeechMs ?? 200)) { this.inSpeech = true; return "start"; }
    if (this.inSpeech && this.silenceMs >= (this.o.silenceMs ?? 850)) { this.inSpeech = false; this.speechMs = 0; return "end"; }
    return null;
  }
  get speaking(): boolean { return this.inSpeech; }
}

/** Whisper-style recognizer: one final per turn, no partials (the app's current path). */
export class BatchSTT implements StreamingSTT {
  readonly id: string;
  private frames: ArrayBuffer[] = [];
  private emit: Emit = () => undefined;
  private running = false;
  private readonly turns: TurnDetector;
  constructor(private readonly o: { id?: string; transcribe: (frames: ArrayBuffer[]) => Promise<string>; turn?: TurnDetector; now?: () => number; maxFrames?: number }) {
    this.id = o.id ?? "groq-whisper";
    this.turns = o.turn ?? new TurnDetector();
  }
  async start(onEvent: Emit): Promise<void> { this.emit = onEvent; this.running = true; }
  pushAudio(frame: ArrayBuffer): void {
    if (!this.running) return;
    const now = this.o.now ?? (() => Date.now());
    const edge = this.turns.push(frame);
    if (edge === "start") { this.frames = []; this.emit({ type: "speech_start", at: now() }); }
    if (this.turns.speaking || edge === "end") {
      if (this.frames.length < (this.o.maxFrames ?? 750)) this.frames.push(frame);
    }
    if (edge === "end") {
      this.emit({ type: "speech_end", at: now() });
      const audio = this.frames;
      this.frames = [];
      const id = nextId("wh");
      this.o.transcribe(audio).then(
        (text) => { if (this.running && text.trim()) this.emit({ type: "final", utteranceId: id, text: text.trim(), confidence: 0.7, at: now() }); },
        (e) => { if (this.running) this.emit({ type: "error", error: `${this.id}: ${e instanceof Error ? e.message : String(e)}`, fatal: false, at: now() }); },
      );
    }
  }
  async stop(): Promise<void> { this.running = false; this.frames = []; }
}

// ------------------------------------------------------------------ fallback chain

/**
 * Runs the first recognizer; a fatal error moves to the next one in the chain (Deepgram ->
 * OpenAI -> Whisper). The switch is reported, never silent.
 */
export class FallbackSTT implements StreamingSTT {
  private index = 0;
  private current: StreamingSTT | null = null;
  private emit: Emit = () => undefined;
  constructor(private readonly chain: (() => StreamingSTT)[], private readonly onSwitch?: (from: string, reason: string, left: number) => void) {}
  get id(): string { return this.current?.id ?? "none"; }
  async start(onEvent: Emit): Promise<void> {
    this.emit = onEvent;
    await this.open();
  }
  private async open(): Promise<void> {
    while (this.index < this.chain.length) {
      const stt = this.chain[this.index]();
      this.current = stt;
      try {
        await stt.start((e) => this.forward(stt, e));
        return;
      } catch (e) {
        this.advance(stt, e instanceof Error ? e.message : String(e));
      }
    }
    this.current = null;
    this.emit({ type: "error", error: "no speech recognizer available", fatal: true, at: Date.now() });
  }
  private forward(from: StreamingSTT, e: SttEvent): void {
    if (from !== this.current) return; // late events of a replaced recognizer
    if (e.type === "error" && e.fatal) {
      this.advance(from, e.error);
      void this.open();
      return;
    }
    this.emit(e);
  }
  private advance(from: StreamingSTT, reason: string): void {
    void from.stop().catch(() => undefined);
    this.index++;
    this.onSwitch?.(from.id, reason, this.chain.length - this.index);
  }
  pushAudio(frame: ArrayBuffer): void { this.current?.pushAudio(frame); }
  async stop(): Promise<void> { const c = this.current; this.current = null; await c?.stop(); }
}
