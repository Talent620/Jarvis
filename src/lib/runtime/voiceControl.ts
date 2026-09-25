// Voice control of the computer (B-034): one switch in Settings starts the streaming voice
// session on the app runtime (startAppVoice) and holds the microphone through the app's voice
// arbiter (owners that use it: the chat microphone and wake word, headset mode, permissions).
// Another owner taking the microphone stops this session and says so in the status; failures
// (no microphone, the recognizer chain gave up) become a status the UI shows, never an exception
// and never a silent "listening".

import type { VoiceOwner } from "../voiceSession";

export type VoiceControlStatus =
  | { state: "off" }
  | { state: "starting" }
  | { state: "listening"; recognizer: string }
  | { state: "error"; message: string };

export interface VoiceControlDeps {
  /** Starts the session; resolves with a stopper and the live recognizer name. */
  start: () => Promise<{ stop: () => Promise<void>; recognizer: () => string }>;
  acquire: (owner: VoiceOwner, onRelease: () => void) => void;
  release: (owner: VoiceOwner) => void;
}

const OWNER: VoiceOwner = "computer";

export class VoiceControl {
  private status: VoiceControlStatus = { state: "off" };
  private listeners = new Set<(s: VoiceControlStatus) => void>();
  private running: { stop: () => Promise<void> } | null = null;
  /** Bumped by every start/stop: a start that finishes after a stop is undone at once. */
  private epoch = 0;

  constructor(private readonly deps: VoiceControlDeps) {}

  private recognizer: (() => string) | null = null;

  /** The status; while listening the recognizer name is read live (it changes on fallback). */
  get current(): VoiceControlStatus {
    return this.status.state === "listening" && this.recognizer ? { state: "listening", recognizer: this.recognizer() } : this.status;
  }

  /** Recognizer errors from the voice session: a fatal one ends listening with the reason. */
  report(e: { type: string; error?: string; fatal?: boolean }): void {
    if (e.type !== "stt_error" || !e.fatal || !this.running) return;
    void this.stop("failed", e.error ?? "the recognizer stopped");
  }

  subscribe(fn: (s: VoiceControlStatus) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private set(s: VoiceControlStatus): void {
    this.status = s;
    for (const l of [...this.listeners]) { try { l(s); } catch { /* UI listener errors stay local */ } }
  }

  async start(): Promise<VoiceControlStatus> {
    if (this.running || this.status.state === "starting") return this.status;
    const epoch = ++this.epoch;
    this.set({ state: "starting" });
    // Taking the microphone preempts the chat microphone and wake word and headset mode.
    this.deps.acquire(OWNER, () => { void this.stop("preempted"); });
    try {
      const s = await this.deps.start();
      if (epoch !== this.epoch) {
        await s.stop().catch(() => undefined);
        return this.status;
      }
      this.running = s;
      this.recognizer = s.recognizer;
      this.set({ state: "listening", recognizer: s.recognizer() });
    } catch (e) {
      if (epoch === this.epoch) {
        this.deps.release(OWNER);
        this.set({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
    return this.status;
  }

  /**
   * `user`: switched off. `preempted`: another owner took the microphone (not released here, it
   * is theirs now). `failed`: the recognizer gave up. The last two leave an error status, so the
   * panel shows that voice control stopped instead of hiding it.
   */
  async stop(reason: "user" | "preempted" | "failed" = "user", detail?: string): Promise<void> {
    this.epoch++;
    const r = this.running;
    this.running = null;
    this.recognizer = null;
    if (reason !== "preempted") this.deps.release(OWNER);
    if (reason === "user") this.set({ state: "off" });
    else if (reason === "preempted") this.set({ state: "error", message: "mikrofon przejął inny tryb głosowy" });
    else this.set({ state: "error", message: detail ?? "rozpoznawanie mowy przestało działać" });
    if (r) await r.stop().catch(() => undefined);
  }
}
