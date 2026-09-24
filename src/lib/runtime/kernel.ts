// Runtime Kernel (mission 5.1): the single writer of runtime state. Lanes dispatch typed events;
// the kernel deduplicates them, reduces them into state, owns one AbortController per task,
// appends durable events to the task journal and notifies subscribers.

import type { EventInput, KernelEvent } from "./events";
import { isDurable } from "./events";
import type { TaskJournal } from "./journal";
import { initialState, reduce, type KernelState } from "./reducer";
import type { TaskStatus } from "./types";
import { TERMINAL_TASK } from "./types";
import { defaultId, normalizeUtterance } from "./util";

export type DispatchResult =
  | { accepted: true; event: KernelEvent }
  | {
      accepted: false;
      reason: "duplicate_id" | "duplicate_utterance" | "duplicate_final_text" | "idempotency_conflict";
      existingActionId?: string;
    };

export type KernelListener = (state: KernelState, event: KernelEvent) => void;

export interface KernelOptions {
  now?: () => number;
  newId?: (prefix: string) => string;
  journal?: TaskJournal;
  /** Two finals with the same normalized text inside this window are one utterance. */
  finalDedupWindowMs?: number;
  maxSeenKeys?: number;
}

export class TaskAbortedError extends Error {
  constructor(readonly taskId: string, readonly reason: string) {
    super(`task ${taskId} ${reason}`);
    this.name = "AbortError";
  }
}

const MAX_PENDING_JOURNAL = 5000;

export class Kernel {
  private s: KernelState = initialState();
  private readonly now: () => number;
  private readonly newId: (prefix: string) => string;
  private readonly journal?: TaskJournal;
  private readonly finalWindow: number;
  private readonly maxSeen: number;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private controllers = new Map<string, AbortController>();
  private waiters = new Map<string, { resolve: () => void; reject: (e: Error) => void }[]>();
  private listeners = new Set<KernelListener>();
  private notifyQueue: KernelEvent[] = [];
  private notifying = false;
  private pendingJournal: KernelEvent[] = [];
  private flushScheduled = false;
  private flushChain: Promise<void> = Promise.resolve();
  journalErrors = 0;

  constructor(opts: KernelOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.newId = opts.newId ?? defaultId;
    this.journal = opts.journal;
    this.finalWindow = opts.finalDedupWindowMs ?? 1500;
    this.maxSeen = opts.maxSeenKeys ?? 5000;
  }

  get state(): KernelState {
    return this.s;
  }

  id(prefix: string): string {
    return this.newId(prefix);
  }

  subscribe(fn: KernelListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Dedup, reduce, run side effects, journal and notify. Synchronous; safe to call from listeners. */
  dispatch(input: EventInput): DispatchResult {
    const event = { ...input, id: input.id ?? this.newId("ev"), at: input.at ?? this.now() } as KernelEvent;
    const dup = this.checkDuplicate(event);
    if (dup) return dup;
    this.remember(`id:${event.id}`);
    for (const k of semanticKeys(event)) this.remember(k);

    const prev = this.s;
    this.s = reduce(prev, event);
    this.applySideEffects(prev, event);
    if (this.journal && isDurable(event)) this.enqueueJournal(event);

    this.notifyQueue.push(event);
    if (!this.notifying) this.drainNotifications();
    return { accepted: true, event };
  }

  /** AbortSignal of a task. Unknown or finished tasks get an already aborted signal. */
  signal(taskId: string): AbortSignal {
    const c = this.controllers.get(taskId);
    if (c) return c.signal;
    const dead = new AbortController();
    dead.abort(new TaskAbortedError(taskId, "is not running"));
    return dead.signal;
  }

  /**
   * Resolves when the task may run its next micro-action (status "running"); waits while it is
   * paused, waiting for consent or blocked; rejects once it is cancelled, failed or done.
   */
  waitRunnable(taskId: string): Promise<void> {
    const t = this.s.tasks[taskId];
    if (!t) return Promise.reject(new TaskAbortedError(taskId, "does not exist"));
    if (t.status === "running") return Promise.resolve();
    if (TERMINAL_TASK.has(t.status)) return Promise.reject(new TaskAbortedError(taskId, t.status));
    return new Promise((resolve, reject) => {
      const list = this.waiters.get(taskId) ?? [];
      list.push({ resolve, reject });
      this.waiters.set(taskId, list);
    });
  }

  /** Wait until every durable event dispatched so far is in the journal (or failed to write). */
  flush(): Promise<void> {
    this.flushScheduled = false;
    const batch = this.pendingJournal.splice(0);
    if (!batch.length || !this.journal) return this.flushChain;
    const journal = this.journal;
    this.flushChain = this.flushChain.then(async () => {
      try {
        await journal.append(batch);
      } catch {
        this.journalErrors++;
        // Keep the batch for the next flush, bounded so a dead journal cannot grow memory forever.
        this.pendingJournal = [...batch, ...this.pendingJournal].slice(-MAX_PENDING_JOURNAL);
      }
    });
    return this.flushChain;
  }

  /**
   * Rebuild state from a journal after a restart. Nothing resumes by itself: running tasks come
   * back paused, and actions that may have had an effect become UNKNOWN_AFTER_ATTEMPT so the
   * action lane must read the target state before any retry.
   */
  static async restore(journal: TaskJournal, opts: Omit<KernelOptions, "journal"> = {}): Promise<Kernel> {
    const k = new Kernel({ ...opts, journal });
    const events = await journal.load();
    let s = initialState();
    for (const e of events) {
      if (k.seen.has(`id:${e.id}`)) continue;
      k.remember(`id:${e.id}`);
      for (const key of semanticKeys(e)) k.remember(key);
      s = reduce(s, e);
    }
    const at = k.now();
    const tasks = { ...s.tasks };
    for (const [id, t] of Object.entries(tasks)) {
      if (t.status === "running" || t.status === "waiting_consent") {
        tasks[id] = { ...t, status: "paused", statusReason: "restored after restart", updatedAt: at };
      }
    }
    const actions = { ...s.actions };
    for (const [id, a] of Object.entries(actions)) {
      if (a.status === "started" || a.status === "ATTEMPTED") {
        actions[id] = a.external || a.status === "ATTEMPTED"
          ? { ...a, status: "UNKNOWN_AFTER_ATTEMPT", reason: "interrupted by restart" }
          : { ...a, status: "FAILED", reason: "interrupted by restart", endedAt: at };
      }
    }
    const consents = { ...s.consents };
    for (const [id, c] of Object.entries(consents)) {
      if (c.status === "pending") consents[id] = { ...c, status: "denied", decidedAt: at };
    }
    k.s = { ...s, tasks, actions, consents };
    for (const [id, t] of Object.entries(k.s.tasks)) if (!TERMINAL_TASK.has(t.status)) k.controllers.set(id, new AbortController());
    return k;
  }

  // ---------------------------------------------------------------- internals

  private checkDuplicate(e: KernelEvent): DispatchResult | null {
    if (this.seen.has(`id:${e.id}`)) return { accepted: false, reason: "duplicate_id" };
    for (const k of semanticKeys(e)) if (this.seen.has(k)) return { accepted: false, reason: "duplicate_utterance" };
    if (e.type === "SpeechFinal") {
      const last = this.s.lastFinal;
      if (last && e.at - last.at <= this.finalWindow && normalizeUtterance(last.text) === normalizeUtterance(e.text)) {
        return { accepted: false, reason: "duplicate_final_text" };
      }
    }
    if (e.type === "ActionStarted" && e.idempotencyKey) {
      const owner = this.s.idempotency[e.idempotencyKey];
      if (owner) return { accepted: false, reason: "idempotency_conflict", existingActionId: owner };
    }
    return null;
  }

  private remember(key: string): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.seenOrder.push(key);
    if (this.seenOrder.length > this.maxSeen) {
      const drop = this.seenOrder.splice(0, this.seenOrder.length - this.maxSeen);
      for (const d of drop) this.seen.delete(d);
    }
  }

  private applySideEffects(prev: KernelState, e: KernelEvent): void {
    if (e.type === "TaskCreated" && this.s.tasks[e.taskId] && !this.controllers.has(e.taskId)) {
      this.controllers.set(e.taskId, new AbortController());
    }
    for (const [id, t] of Object.entries(this.s.tasks)) {
      const before: TaskStatus | undefined = prev.tasks[id]?.status;
      if (before === t.status) continue;
      if (t.status === "cancelled") {
        this.controllers.get(id)?.abort(new TaskAbortedError(id, t.statusReason ?? "cancelled"));
      }
      if (TERMINAL_TASK.has(t.status)) {
        this.controllers.delete(id);
        this.settleWaiters(id, new TaskAbortedError(id, t.status));
      } else {
        // A reopened (amended) task gets a fresh controller.
        if (!this.controllers.has(id)) this.controllers.set(id, new AbortController());
        if (t.status === "running") this.settleWaiters(id);
      }
    }
  }

  private settleWaiters(taskId: string, error?: Error): void {
    const list = this.waiters.get(taskId);
    if (!list) return;
    this.waiters.delete(taskId);
    for (const w of list) {
      if (error) w.reject(error);
      else w.resolve();
    }
  }

  private enqueueJournal(e: KernelEvent): void {
    this.pendingJournal.push(e);
    if (this.pendingJournal.length > MAX_PENDING_JOURNAL) this.pendingJournal.splice(0, this.pendingJournal.length - MAX_PENDING_JOURNAL);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => { if (this.flushScheduled) void this.flush(); });
    }
  }

  private drainNotifications(): void {
    this.notifying = true;
    try {
      while (this.notifyQueue.length) {
        const ev = this.notifyQueue.shift() as KernelEvent;
        for (const fn of [...this.listeners]) {
          try { fn(this.s, ev); } catch { /* a faulty listener must not break the kernel */ }
        }
      }
    } finally {
      this.notifying = false;
    }
  }
}

/** Keys that identify "the same thing said twice" independent of the event id. */
function semanticKeys(e: KernelEvent): string[] {
  switch (e.type) {
    case "SpeechFinal": return [`final:${e.utteranceId}`];
    case "ControlIntent": return e.utteranceId ? [`ctl:${e.utteranceId}:${e.control}`] : [];
    case "ConversationIntent": return e.utteranceId ? [`ci:${e.utteranceId}:${e.intent}`] : [];
    default: return [];
  }
}
