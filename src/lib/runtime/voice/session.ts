// Voice session (mission 5.14): streaming recognizer in, JarvisRuntime in the middle, streaming
// speech out. It owns what only the audio side can know: whether a partial is the user or our
// own voice coming back (echo), when the user talks over JARVIS (barge-in: speech stops at
// once), how the microphone is gated (always, wake word, push-to-talk), and latency marks.
// It is the runtime's Speaker, so everything JARVIS says goes through the same queue.

import { parseCommand } from "../commands";
import type { Kernel } from "../kernel";
import { resolveReference } from "../resolve";
import type { Speaker } from "../lanes/runtime";
import { normalizeUtterance } from "../util";
import { LatencyRecorder } from "./latency";
import type { Earcon, ListenMode, StreamingSTT, StreamingTTS, SttEvent } from "./types";

/** The part of JarvisRuntime a voice session drives. */
export interface VoiceRuntime {
  readonly kernel: Kernel;
  onPartial(p: { utteranceId: string; text: string; stability: number; userSpeech: boolean }): unknown;
  onFinal(f: { utteranceId: string; text: string; confidence?: number; source?: "stt" | "typed" }): unknown;
  isBusy?(): boolean;
}

export interface VoiceSessionOptions {
  stt: StreamingSTT;
  tts: StreamingTTS;
  mode?: ListenMode;
  /** Wake words, matched on normalized text (no diacritics). */
  wakeWords?: RegExp;
  /** After JARVIS spoke or heard a command, how long no wake word is needed. */
  followUpMs?: number;
  /** How long our own speech may still come back through the microphone. */
  echoTailMs?: number;
  /** A partial at least this stable, from the user, stops JARVIS talking. */
  bargeInStability?: number;
  /** Reads only (index, candidates, warm a model). Never an effect. */
  speculate?: (partialText: string) => void;
  /** Clips rendered ahead of time for instant confirmations. */
  cachedPhrases?: string[];
  /** An action still silent after this long gets a short "Sekunda." (0 disables). */
  holdOnMs?: number;
  latency?: LatencyRecorder;
  now?: () => number;
  onEvent?: (e: VoiceSessionEvent) => void;
}

export type VoiceSessionEvent =
  | { type: "echo_ignored"; text: string }
  | { type: "gated"; text: string; reason: string }
  | { type: "barge_in"; text: string }
  | { type: "stt_error"; error: string; fatal: boolean };

export const DEFAULT_CACHED_PHRASES = ["Już.", "Mam.", "Sekunda.", "Nie znalazłem.", "Czekam.", "Dobrze.", "Wracam do pracy."];
const WAKE = /\b(jarvis|dzarwis|dzarvis|dzarwisie|jarvisie)\b/;
const BACKCHANNEL = new Set(["mhm", "aha", "yhm", "uhm", "hmm", "hm", "eee", "yyy"]);

const words = (t: string): string[] => normalizeUtterance(t).split(" ").filter(Boolean);

/** Split text into sentences for streaming speech. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of text) {
    cur += ch;
    if (".!?…".includes(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export class VoiceSession implements Speaker {
  readonly latency: LatencyRecorder;
  private runtime: VoiceRuntime | null = null;
  private readonly now: () => number;
  private readonly mode: ListenMode;
  private readonly cached: Set<string>;
  private queue: { text: string; utteranceId?: string }[] = [];
  private playing = false;
  private generation = 0;
  private speakingText: string | null = null;
  private recentSpoken: { text: string; endedAt: number }[] = [];
  private lastInteraction = -Infinity;
  private pressed = false;
  private allowed = new Set<string>();
  private vadSpeech = false;
  private lastFinalId: string | undefined;
  private lastUserPartialId: string | undefined;
  private speechStartAt: number | undefined;
  private runningUtterance: string | undefined;
  private offKernel: (() => void) | null = null;
  private holdOnTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly o: VoiceSessionOptions) {
    this.now = o.now ?? (() => Date.now());
    this.mode = o.mode ?? "always";
    this.latency = o.latency ?? new LatencyRecorder();
    this.cached = new Set(o.cachedPhrases ?? DEFAULT_CACHED_PHRASES);
  }

  /** Connect the runtime (created with this session as its speaker). */
  attach(runtime: VoiceRuntime): void {
    this.runtime = runtime;
    this.offKernel?.();
    this.offKernel = runtime.kernel.subscribe((_s, e) => {
      if (e.type === "ConversationIntent" && (e.intent === "NEW_TASK" || e.intent === "AMEND_TASK")) {
        this.runningUtterance = e.utteranceId;
        this.armHoldOn(e.utteranceId);
      } else if (e.type === "ActionStarted") this.latency.mark(this.runningUtterance, "action_start", this.now());
      else if (e.type === "ActionVerified") this.latency.mark(this.runningUtterance, "verified", this.now());
    });
  }

  async start(): Promise<void> {
    this.running = true;
    await this.o.tts.prepare?.([...this.cached]).catch(() => undefined);
    await this.o.stt.start((e) => this.onStt(e));
    this.earcon("listening");
  }

  /** A long action gets a short spoken "Sekunda." so silence does not feel like a hang. */
  private armHoldOn(utteranceId: string | undefined): void {
    const ms = this.o.holdOnMs ?? 1200;
    if (this.holdOnTimer) clearTimeout(this.holdOnTimer);
    this.holdOnTimer = null;
    if (!ms || !utteranceId) return;
    this.holdOnTimer = setTimeout(() => {
      this.holdOnTimer = null;
      const t = this.latency.timeline(utteranceId);
      if (this.running && !t?.first_reply && this.runningUtterance === utteranceId && !this.speaking) {
        this.earcon("working");
        this.say("Sekunda.", { utteranceId: `${utteranceId}#hold` });
      }
    }, ms);
  }

  async stop(): Promise<void> {
    if (this.holdOnTimer) clearTimeout(this.holdOnTimer);
    this.holdOnTimer = null;
    this.running = false;
    this.cancel();
    this.offKernel?.();
    this.offKernel = null;
    await this.o.stt.stop();
  }

  pushAudio(frame: ArrayBuffer): void {
    if (this.running) this.o.stt.pushAudio(frame);
  }

  /** Push-to-talk button. */
  setPushToTalk(pressed: boolean): void {
    this.pressed = pressed;
  }

  get speaking(): boolean {
    return this.speakingText !== null || this.queue.length > 0;
  }

  // ------------------------------------------------------------------ Speaker

  say(text: string, meta?: { utteranceId?: string }): void {
    const id = meta?.utteranceId ?? this.lastFinalId;
    this.latency.mark(id, "first_reply", this.now());
    for (const s of sentences(text)) this.queue.push({ text: s, utteranceId: id });
    this.lastInteraction = this.now();
    if (!this.playing) void this.play();
  }

  cancel(): void {
    const wasSpeaking = this.speaking;
    this.generation++;
    this.queue = [];
    this.o.tts.cancel();
    if (this.speakingText) this.remember(this.speakingText);
    this.speakingText = null;
    // Attributed to the utterance that interrupted (a barge-in partial or a spoken "stop").
    if (wasSpeaking) this.latency.mark(this.lastUserPartialId ?? this.lastFinalId, "cancel", this.now());
  }

  private async play(): Promise<void> {
    this.playing = true;
    const gen = this.generation;
    try {
      while (this.queue.length && gen === this.generation) {
        const item = this.queue.shift()!;
        this.speakingText = item.text;
        const hooks = { onFirstAudio: () => this.latency.mark(item.utteranceId, "first_audio", this.now()) };
        try {
          let done = false;
          if (this.cached.has(item.text) && this.o.tts.playCached) done = await this.o.tts.playCached(item.text, hooks);
          if (!done && gen === this.generation) await this.o.tts.speak(item.text, hooks);
        } catch {
          this.earcon("error"); // one failed sentence must not silence the rest
        }
        if (gen === this.generation) { this.remember(item.text); this.speakingText = null; }
      }
    } finally {
      this.playing = false;
      // Something queued after a cancel starts a new round.
      if (this.queue.length && gen !== this.generation) void this.play();
    }
    this.lastInteraction = this.now();
  }

  private remember(text: string): void {
    this.recentSpoken.push({ text, endedAt: this.now() });
    if (this.recentSpoken.length > 6) this.recentSpoken.shift();
  }

  private earcon(kind: Earcon): void {
    try { this.o.tts.earcon?.(kind); } catch { /* sounds are optional */ }
  }

  // ------------------------------------------------------------------ recognizer

  /**
   * Our own speech coming back through the microphone? Compared with everything JARVIS said in
   * the last moments as one bag of words (the microphone hears across sentence ends). A single
   * word in a growing partial is held back if JARVIS just said it; a single-word final is echo
   * only when JARVIS said exactly that, so a short "tak" or "stop" from the user gets through.
   */
  isEcho(text: string, kind: "partial" | "final" = "final"): boolean {
    const heard = words(text);
    if (!heard.length) return false;
    const tail = this.o.echoTailMs ?? 1500;
    const now = this.now();
    const spoken = [
      ...this.recentSpoken.filter((r) => now - r.endedAt <= tail).map((r) => r.text),
      ...(this.speakingText ? [this.speakingText] : []),
    ];
    if (!spoken.length) return false;
    const bag = new Set(spoken.flatMap(words));
    if (heard.length === 1) {
      return kind === "partial" ? bag.has(heard[0]) : spoken.some((s) => { const w = words(s); return w.length === 1 && w[0] === heard[0]; });
    }
    return heard.filter((w) => bag.has(w)).length / heard.length >= 0.7;
  }

  private gate(utteranceId: string, text: string): string | null {
    if (this.mode === "always" || this.allowed.has(utteranceId)) return null;
    if (this.mode === "ptt") {
      if (this.pressed) { this.allow(utteranceId); return null; }
      return "push-to-talk released";
    }
    // Wake word mode: the word itself, a follow-up window, JARVIS talking, or a running task.
    const now = this.now();
    const open = WAKE.test(normalizeUtterance(text)) || now - this.lastInteraction <= (this.o.followUpMs ?? 8000)
      || this.speaking || !!this.runtime?.isBusy?.();
    if (open) { this.allow(utteranceId); return null; }
    return "no wake word";
  }

  /** Utterances let through the gate until their final; bounded (partials may never finish). */
  private allow(utteranceId: string): void {
    this.allowed.add(utteranceId);
    if (this.allowed.size > 64) this.allowed.delete(this.allowed.values().next().value as string);
  }

  private onStt(e: SttEvent): void {
    const rt = this.runtime;
    if (!rt) return;
    switch (e.type) {
      case "speech_start":
        this.vadSpeech = true;
        this.speechStartAt = e.at;
        return;
      case "speech_end":
        this.vadSpeech = false;
        return;
      case "error":
        this.o.onEvent?.({ type: "stt_error", error: e.error, fatal: e.fatal });
        if (e.fatal) this.earcon("error");
        return;
      case "partial": {
        const reason = this.gate(e.utteranceId, e.text);
        if (reason) { this.o.onEvent?.({ type: "gated", text: e.text, reason }); return; }
        const echo = this.isEcho(e.text, "partial");
        if (echo) { this.o.onEvent?.({ type: "echo_ignored", text: e.text }); }
        else {
          if (this.speechStartAt !== undefined) { this.latency.mark(e.utteranceId, "speech_start", this.speechStartAt); this.speechStartAt = undefined; }
          this.latency.mark(e.utteranceId, "first_partial", e.at);
          this.lastUserPartialId = e.utteranceId;
        }
        rt.onPartial({ utteranceId: e.utteranceId, text: e.text, stability: e.stability, userSpeech: !echo });
        if (!echo) {
          if (this.speaking && e.stability >= (this.o.bargeInStability ?? 0.5) && this.isRealSpeech(e.text)) this.bargeIn(e.text);
          try { (this.o.speculate ?? this.defaultSpeculate)(e.text); } catch { /* speculation must never break listening */ }
        }
        return;
      }
      case "final": {
        const reason = this.gate(e.utteranceId, e.text);
        this.allowed.delete(e.utteranceId);
        if (reason) { this.o.onEvent?.({ type: "gated", text: e.text, reason }); return; }
        if (this.isEcho(e.text, "final")) { this.o.onEvent?.({ type: "echo_ignored", text: e.text }); return; }
        this.latency.mark(e.utteranceId, "first_partial", e.at);
        this.lastUserPartialId = e.utteranceId;
        if (this.speaking && this.isRealSpeech(e.text)) this.bargeIn(e.text);
        this.latency.mark(e.utteranceId, "final", e.at);
        this.lastFinalId = e.utteranceId;
        this.lastUserPartialId = undefined;
        this.lastInteraction = this.now();
        rt.onFinal({ utteranceId: e.utteranceId, text: e.text, confidence: e.confidence, source: "stt" });
        this.latency.mark(e.utteranceId, "intent", this.now());
        return;
      }
    }
  }

  /** Default speculation: parse and resolve the target on current state. Pure reads, nothing dispatched. */
  private readonly defaultSpeculate = (text: string): void => {
    const rt = this.runtime;
    if (!rt) return;
    const cmd = parseCommand(text);
    const query = "query" in cmd ? cmd.query : undefined;
    if (!query) return;
    const verb = cmd.type === "selectText" ? "select" : cmd.type === "copy" ? "copy" : cmd.type === "send" ? "send" : cmd.type === "browser.openItem" ? "open" : "show";
    this.speculated = { text, resolution: resolveReference(rt.kernel.state, { query, verb }).status };
  };

  /** Last speculative resolution (diagnostics; the final is resolved again for real). */
  speculated: { text: string; resolution: string } | null = null;

  private isRealSpeech(text: string): boolean {
    const w = words(text);
    return w.length > 1 || (w.length === 1 && !BACKCHANNEL.has(w[0]) && w[0].length > 1);
  }

  private bargeIn(text: string): void {
    this.o.onEvent?.({ type: "barge_in", text });
    this.cancel();
  }

  /** vadSpeech is kept for diagnostics (the VAD saw speech right now). */
  get hearing(): boolean {
    return this.vadSpeech;
  }
}
