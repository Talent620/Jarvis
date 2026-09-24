// JARVIS runtime orchestrator (mission 5.2): four lanes that talk only through the kernel.
// PERCEPTION: environment events -> kernel (ActionSession.start).
// REFLEX: controls from partials (tier 0) and finals, no LLM.
// CONVERSATION: side questions answered from the Situation Snapshot, concurrently with actions.
// ACTION: a serial queue of verified tasks; conversation never blocks it and never mutates it.

import type { ControlKind } from "../events";
import { parseCommand, type Command } from "../commands";
import type { ComputerEnvironment } from "../env/types";
import type { Kernel } from "../kernel";
import { focusedTaskId } from "../reducer";
import { ActionSession, type SessionOptions, type TurnResult } from "../session";
import { quoteData, situationSnapshot } from "../snapshot";
import { TERMINAL_TASK } from "../types";
import { CONVERSATION_SYSTEM, isStatusQuestion, statusReply, type ConversationModel, type ConversationTurn } from "./conversation";
import { focusedContent, isSummaryRequest, summarizeUntrusted, type IsolatedModel } from "../untrusted";
import { classifyReflex, isStrictConsent, tier0FromPartial, DEFAULT_PARTIAL_POLICY, type PartialPolicy } from "./reflex";

/** Voice output. cancel() must stop audio immediately (barge-in). */
export interface Speaker {
  /** `utteranceId`: the user's utterance this answers (latency marks). */
  say(text: string, meta?: { utteranceId?: string }): void;
  cancel(): void;
}

export type Route = "control" | "action" | "amend" | "answer" | "side_chat" | "summary" | "status" | "ignored" | "duplicate";

export interface RuntimeTurn {
  utteranceId: string;
  text: string;
  route: Route;
  control?: ControlKind;
  say?: string;
  result?: TurnResult;
  at: number;
}

export interface RuntimeOptions {
  kernel: Kernel;
  env: ComputerEnvironment;
  model?: ConversationModel;
  /** Isolated model for summaries of screen text (no tools, no history). */
  summarizer?: IsolatedModel;
  speaker?: Speaker;
  session?: SessionOptions;
  partialPolicy?: PartialPolicy;
  now?: () => number;
}

const SILENT: Speaker = { say: () => undefined, cancel: () => undefined };
const AMENDABLE = new Set<Command["type"]>(["focusItem"]);

export class JarvisRuntime {
  readonly kernel: Kernel;
  readonly session: ActionSession;
  readonly turns: RuntimeTurn[] = [];
  private readonly speaker: Speaker;
  private readonly model?: ConversationModel;
  private readonly summarizer?: IsolatedModel;
  private readonly policy: PartialPolicy;
  private readonly now: () => number;
  private actionQueue: Promise<void> = Promise.resolve();
  private generation = 0;
  private pendingActions = 0;
  private sideChats = new Set<Promise<void>>();
  private history: ConversationTurn[] = [];
  private seq = 0;
  private lastActionTaskId: string | null = null;
  /** Commands accepted but not started yet (for "co teraz robisz?"). */
  private queuedTexts: string[] = [];
  /** The utterance whose command the action lane is running now (questions belong to it). */
  private runningUtteranceId: string | null = null;
  /** The consent whose question the user actually heard: "tak" answers that one only. */
  private announcedConsentId: string | null = null;

  constructor(opts: RuntimeOptions) {
    this.kernel = opts.kernel;
    this.speaker = opts.speaker ?? SILENT;
    this.model = opts.model;
    this.summarizer = opts.summarizer;
    this.policy = opts.partialPolicy ?? DEFAULT_PARTIAL_POLICY;
    this.now = opts.now ?? (() => Date.now());
    this.session = new ActionSession(opts.kernel, opts.env, {
      ...opts.session,
      now: this.now,
      onQuestion: (q, consentId) => {
        opts.session?.onQuestion?.(q, consentId);
        if (consentId) this.announcedConsentId = consentId;
        this.say(q, "runtime", this.runningUtteranceId ?? undefined);
      },
    });
  }

  start(): Promise<void> {
    return this.session.start();
  }

  stop(): void {
    this.session.stop();
  }

  /** An action is running or queued. */
  isBusy(): boolean {
    return this.pendingActions > 0;
  }

  /** The user was asked something (a consent or "który Marcin?") and it is still open. */
  awaitingAnswer(): boolean {
    return this.session.hasPendingQuestion() || !!this.announcedConsent();
  }

  /**
   * Would the runtime take this utterance (answer, control, status, action) rather than leave it
   * to a chat? No side effects. `routeAction` decides whether a parsed command is for the runtime.
   */
  claims(text: string, routeAction: (cmd: Command) => boolean): boolean {
    if (this.session.hasPendingQuestion() && this.session.isAnswer(text)) return true;
    const reflex = classifyReflex(text);
    const live = this.isBusy() || !!this.lastLiveTask();
    if (reflex.kind === "control") {
      switch (reflex.control) {
        case "confirm": {
          if (this.announcedConsent()) return true;
          const cmd = parseCommand(text); // "wyślij" with nothing to confirm is a send command
          return cmd.type !== "unknown" && routeAction(cmd);
        }
        case "reject":
          return !!this.announcedConsent();
        case "undo":
          return Object.values(this.kernel.state.tasks).some((t) => t.undo.length > 0);
        case "next":
          return Object.values(this.kernel.state.tasks).some((t) => t.status === "paused") || routeAction({ type: "focusItem", query: { relative: "next" } });
        default:
          return live;
      }
    }
    if (isStatusQuestion(text)) return live;
    if (isSummaryRequest(text)) return !!focusedContent(this.kernel.state);
    return reflex.kind === "action" && routeAction(reflex.command);
  }

  /** Resolves when every queued action and side chat has finished. */
  async idle(): Promise<void> {
    for (;;) {
      const pending = [this.actionQueue, ...this.sideChats];
      await Promise.allSettled(pending);
      if (this.pendingActions === 0 && this.sideChats.size === 0) return;
    }
  }

  private log(t: Omit<RuntimeTurn, "at">): RuntimeTurn {
    const turn = { ...t, at: this.now() };
    this.turns.push(turn);
    return turn;
  }

  /**
   * Speak. What reaches the conversation model's history depends on the origin: the model's own
   * replies as they are, action results and questions (which quote comments, titles, clipboard)
   * only as one quoted data line, so screen text never sits unquoted in the model's context.
   */
  private say(text: string, origin: "model" | "runtime" = "runtime", utteranceId?: string): void {
    this.history.push({ role: "assistant", text: origin === "model" ? text : `[wynik akcji, dane] ${quoteData(text, 160)}` });
    if (this.history.length > 12) this.history.splice(0, this.history.length - 12);
    this.speaker.say(text, { utteranceId });
  }

  // ---------------------------------------------------------------- speech input

  /** Streaming STT partial. Only tier-0 controls act here; everything else waits for the final. */
  onPartial(p: { utteranceId: string; text: string; stability: number; userSpeech: boolean }): RuntimeTurn | null {
    this.kernel.dispatch({ type: "SpeechPartial", utteranceId: p.utteranceId, text: p.text, stability: p.stability, userSpeech: p.userSpeech });
    const control = tier0FromPartial(p.text, p.stability, p.userSpeech, this.policy);
    if (!control) return null;
    return this.control(p.utteranceId, p.text, control, 0);
  }

  /** Final STT result (or typed text). Returns once routed; actions continue in the background. */
  onFinal(f: { utteranceId: string; text: string; confidence?: number; source?: "stt" | "typed" }): RuntimeTurn {
    const accepted = this.kernel.dispatch({ type: "SpeechFinal", utteranceId: f.utteranceId, text: f.text, confidence: f.confidence ?? 1, source: f.source ?? "stt" });
    if (!accepted.accepted) return this.log({ utteranceId: f.utteranceId, text: f.text, route: "duplicate" });
    this.history.push({ role: "user", text: f.text });
    return this.route(f.utteranceId, f.text);
  }

  onText(text: string): RuntimeTurn {
    return this.onFinal({ utteranceId: `typed-${++this.seq}-${this.now()}`, text, source: "typed" });
  }

  // ---------------------------------------------------------------- routing

  private route(utteranceId: string, text: string): RuntimeTurn {
    // A task is waiting for an answer ("Którego Marcina?"): try that first.
    if (this.session.hasPendingQuestion() && this.session.answer(text)) {
      this.kernel.dispatch({ type: "ConversationIntent", intent: "CONFIRM", text, utteranceId });
      return this.log({ utteranceId, text, route: "answer" });
    }
    const reflex = classifyReflex(text);
    if (reflex.kind === "control") {
      // "dalej": resume a paused task, otherwise it means "the next item".
      if (reflex.control === "next") {
        const paused = Object.values(this.kernel.state.tasks).some((t) => t.status === "paused");
        if (paused) return this.control(utteranceId, text, "resume", 1);
        return this.enqueueAction(utteranceId, text, { type: "focusItem", query: { relative: "next" } });
      }
      if (reflex.control === "confirm" || reflex.control === "reject") {
        const pending = this.announcedConsent();
        if (pending && reflex.control === "confirm" && !isStrictConsent(text)) {
          // "ok" or "dobra" is not a yes to sending something outside: ask for a clear answer.
          const ask = "Powiedz wyraźnie: tak, wyślij. Albo: nie.";
          this.say(ask, "runtime", utteranceId);
          return this.log({ utteranceId, text, route: "ignored", control: reflex.control, say: ask });
        }
        if (pending) return this.control(utteranceId, text, reflex.control, 2);
        if (reflex.control === "confirm" && parseCommand(text).type !== "unknown") return this.enqueueAction(utteranceId, text, parseCommand(text));
        this.say("Nie mam teraz nic do potwierdzenia.", "runtime", utteranceId);
        return this.log({ utteranceId, text, route: "ignored", control: reflex.control });
      }
      return this.control(utteranceId, text, reflex.control, reflex.tier);
    }
    if (isSummaryRequest(text)) return this.summary(utteranceId, text);
    if (isStatusQuestion(text)) {
      this.kernel.dispatch({ type: "ConversationIntent", intent: "SIDE_CHAT", text, utteranceId });
      const reply = statusReply(this.kernel.state, this.queuedTexts);
      this.say(reply, "runtime", utteranceId);
      return this.log({ utteranceId, text, route: "status", say: reply });
    }
    if (reflex.kind === "action") return this.enqueueAction(utteranceId, text, reflex.command);
    return this.sideChat(utteranceId, text);
  }

  private control(utteranceId: string, text: string, control: ControlKind, tier: 0 | 1 | 2): RuntimeTurn {
    const k = this.kernel;
    if (control === "stop") this.speaker.cancel(); // barge-in first: silence is immediate
    if (control === "undo") {
      const turn = this.log({ utteranceId, text, route: "control", control });
      this.queue(async () => {
        const gen = this.generation;
        const r = await this.session.undo();
        turn.result = r;
        turn.say = r.say;
        if (gen === this.generation) this.say(r.say, "runtime", utteranceId); // a "stop" meanwhile means silence
      });
      return turn;
    }
    const target = focusedTaskId(k.state) ?? this.lastLiveTask();
    const res = k.dispatch({ type: "ControlIntent", control, tier, utteranceId, taskId: target });
    if (!res.accepted) return this.log({ utteranceId, text, route: "duplicate", control });
    let say: string | undefined;
    if (control === "stop" || control === "cancel") {
      this.generation++; // queued actions that have not started are dropped
      // Silence is the answer to "stop": nothing is spoken after the barge-in.
      return this.log({ utteranceId, text, route: "control", control });
    } else if (control === "pause") {
      say = "Czekam.";
    } else if (control === "resume") {
      say = "Wracam do pracy.";
    } else if (control === "confirm" || control === "reject") {
      const pending = this.announcedConsent();
      if (pending) k.dispatch({ type: control === "confirm" ? "ConsentGranted" : "ConsentDenied", consentId: pending.id });
      this.announcedConsentId = null;
      say = control === "confirm" ? "Dobrze." : "Nie wysyłam.";
    }
    if (say) this.say(say, "runtime", utteranceId);
    return this.log({ utteranceId, text, route: "control", control, say });
  }

  /** The pending consent the user was asked about, if it is still pending. */
  private announcedConsent() {
    const c = this.announcedConsentId ? this.kernel.state.consents[this.announcedConsentId] : undefined;
    return c && c.status === "pending" ? c : undefined;
  }

  private lastLiveTask(): string | undefined {
    const s = this.kernel.state;
    for (let i = s.taskOrder.length - 1; i >= 0; i--) {
      const t = s.tasks[s.taskOrder[i]];
      if (t && !TERMINAL_TASK.has(t.status)) return t.id;
    }
    return undefined;
  }

  private queue(fn: () => Promise<void>): void {
    const gen = this.generation;
    this.pendingActions++;
    this.actionQueue = this.actionQueue
      .then(async () => {
        if (gen === this.generation) await fn();
        else this.queuedTexts = []; // dropped by "stop"
      })
      .catch(() => undefined)
      .finally(() => { this.pendingActions--; });
  }

  private enqueueAction(utteranceId: string, text: string, command: Command): RuntimeTurn {
    const k = this.kernel;
    const turn = this.log({ utteranceId, text, route: "action" });
    this.queuedTexts.push(text);
    this.queue(async () => {
      this.queuedTexts.splice(this.queuedTexts.indexOf(text), 1);
      // Decided when the command runs, not when it was heard: "nie ten, następny" / "poprzedni" /
      // "wróćmy do" refine the last item-choosing task instead of starting a new goal.
      const last = this.lastActionTaskId ? k.state.tasks[this.lastActionTaskId] : undefined;
      const q = command.type === "focusItem" ? command.query : undefined;
      const amend = !!last && AMENDABLE.has(last.kind as Command["type"]) && command.type === "focusItem" && !!q && (!!q.reject || q.relative !== undefined || !!q.returnTo);
      if (amend) turn.route = "amend";
      k.dispatch({ type: "ConversationIntent", intent: amend ? "AMEND_TASK" : "NEW_TASK", text, utteranceId, taskId: amend ? last!.id : undefined });
      this.runningUtteranceId = utteranceId;
      const r = await this.session.handle(text, { command, amendTaskId: amend ? last!.id : undefined }).finally(() => { this.runningUtteranceId = null; });
      if (r.taskId) this.lastActionTaskId = r.taskId;
      turn.result = r;
      turn.say = r.say;
      if (k.state.tasks[r.taskId ?? ""]?.status !== "cancelled") this.say(r.say, "runtime", utteranceId);
    });
    return turn;
  }

  /** "streść to": the focused text goes to an isolated model call; the answer is data. */
  private summary(utteranceId: string, text: string): RuntimeTurn {
    this.kernel.dispatch({ type: "ConversationIntent", intent: "SIDE_CHAT", text, utteranceId });
    const turn = this.log({ utteranceId, text, route: "summary" });
    const content = focusedContent(this.kernel.state);
    const summarizer = this.summarizer;
    if (!content || !summarizer) {
      turn.say = content ? "Nie mam modelu do streszczania." : "Nie mam przed sobą tekstu do streszczenia.";
      this.say(turn.say, "runtime", utteranceId);
      return turn;
    }
    const gen = this.generation;
    const p = (async () => {
      try {
        const s = await summarizeUntrusted(summarizer, content);
        turn.say = s.value ? `W skrócie: ${s.value}` : "Nie udało mi się tego streścić.";
      } catch {
        turn.say = "Nie udało mi się tego streścić.";
      }
      if (gen === this.generation) this.say(turn.say, "runtime", utteranceId);
    })();
    this.sideChats.add(p);
    void p.finally(() => this.sideChats.delete(p));
    return turn;
  }

  private sideChat(utteranceId: string, text: string): RuntimeTurn {
    this.kernel.dispatch({ type: "ConversationIntent", intent: "SIDE_CHAT", text, utteranceId });
    const turn = this.log({ utteranceId, text, route: "side_chat" });
    if (!this.model) {
      turn.say = "Tu nie pomogę bez modelu rozmowy, ale dalej robię swoje.";
      this.say(turn.say, "runtime", utteranceId);
      return turn;
    }
    const model = this.model;
    const snapshot = situationSnapshot(this.kernel.state, this.now());
    const gen = this.generation;
    const p = (async () => {
      try {
        const reply = await model.reply({ system: CONVERSATION_SYSTEM, snapshot, utterance: text, history: this.history.slice(-8) });
        turn.say = reply;
        if (gen === this.generation) this.say(reply, "model", utteranceId); // "stop" silences a late answer too
      } catch {
        turn.say = "Nie udało mi się teraz odpowiedzieć.";
        if (gen === this.generation) this.say(turn.say, "runtime", utteranceId);
      }
    })();
    this.sideChats.add(p);
    void p.finally(() => this.sideChats.delete(p));
    return turn;
  }
}
