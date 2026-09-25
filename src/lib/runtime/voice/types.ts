// Voice interfaces (mission 5.14). Audio in, text events out, speech back, all behind small
// interfaces so the same session runs on a microphone, a recorded event stream or a test.

/** What a streaming recognizer reports. Times are milliseconds (session clock). */
export type SttEvent =
  | { type: "speech_start"; at: number }
  | { type: "speech_end"; at: number }
  | { type: "partial"; utteranceId: string; text: string; stability: number; at: number }
  | { type: "final"; utteranceId: string; text: string; confidence: number; at: number }
  | { type: "error"; error: string; fatal: boolean; at: number };

export interface StreamingSTT {
  readonly id: string;
  start(onEvent: (e: SttEvent) => void): Promise<void>;
  /** 16 kHz mono PCM16 frames. */
  pushAudio(frame: ArrayBuffer): void;
  stop(): Promise<void>;
}

/** Minimal WebSocket surface the adapters need (browser WebSocket or a test double). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
}

export type Connect = (url: string, protocols?: string[]) => SocketLike;

export interface StreamingTTS {
  readonly id: string;
  /** Speak one sentence. Resolves when it ended or was cancelled. */
  speak(text: string, hooks?: { onFirstAudio?: () => void }): Promise<void>;
  /** Stop audio now (barge-in). */
  cancel(): void;
  /** Play a pre-rendered clip ("Już.", "Mam."): instant first audio. False when not cached. */
  playCached?(text: string, hooks?: { onFirstAudio?: () => void }): Promise<boolean> | boolean;
  /** Short state sounds (listening, working, done, error). */
  earcon?(kind: Earcon): void;
  /** Render clips ahead of time. */
  prepare?(texts: string[]): Promise<void>;
}

export type Earcon = "listening" | "working" | "done" | "error";

/** How the microphone is gated. */
export type ListenMode = "always" | "wake" | "ptt";
