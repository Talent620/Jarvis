// Voice control of the computer (B-034): one switch in Settings starts the streaming voice
// session on the app runtime (startAppVoice) and holds the microphone through the app's voice
// arbiter, so the chat wake word, headset mode or Live cannot listen at the same time. Another
// owner taking the microphone stops this session; failures (no microphone, no recognizer) become
// a status the UI shows, never an exception and never a silent "listening".

import type { VoiceOwner } from "../voiceSession";

export type VoiceControlStatus =
  | { state: "off" }
  | { state: "starting" }
  | { state: "listening"; recognizer: string }
  | { state: "error"; message: string };

export interface VoiceControlDeps {
  /** Starts the session; resolves with a stopper (see appRuntime.startAppVoice). */
  start: () => Promise<{ stop: () => Promise<void>; recognizer: string }>;
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

  get current(): VoiceControlStatus {
    return this.status;
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
    // Taking the microphone preempts the chat wake word, headset mode and Live.
    this.deps.acquire(OWNER, () => { void this.stop("preempted"); });
    try {
      const s = await this.deps.start();
      if (epoch !== this.epoch) {
        await s.stop().catch(() => undefined);
        return this.status;
      }
      this.running = s;
      this.set({ state: "listening", recognizer: s.recognizer });
    } catch (e) {
      if (epoch === this.epoch) {
        this.deps.release(OWNER);
        this.set({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
    return this.status;
  }

  /** `preempted`: another owner already holds the microphone, so it is not released here. */
  async stop(reason: "user" | "preempted" = "user"): Promise<void> {
    this.epoch++;
    const r = this.running;
    this.running = null;
    if (reason === "user") this.deps.release(OWNER);
    if (this.status.state !== "error" || reason === "user") this.set({ state: "off" });
    if (r) await r.stop().catch(() => undefined);
  }
}
