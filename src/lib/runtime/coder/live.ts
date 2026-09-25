// Live view of coding tasks in the renderer (M12). Agent events can come by the thousand, so:
// a ring buffer per task (bounded), live state updated in place per event, one notification per
// batch (coalesced in a microtask), and immutable snapshots rebuilt only when something changed
// and someone asks (useSyncExternalStore-friendly). Nothing here serializes the whole log.

import type { CoderEvent, CoderLiveState, CoderResult, CoderTaskState } from "./types";
import { LIVE_CODER_STATES } from "./types";

export interface CoderStoreSnapshot {
  version: number;
  tasks: CoderLiveState[];
  results: Record<string, CoderResult>;
}

/** Apply one structured event to a task's live state (in place). Pure in its inputs otherwise. */
export function applyCoderEvent(live: CoderLiveState, e: CoderEvent): void {
  if (e.model) live.model = e.model;
  if (e.backend) live.backend = e.backend;
  if (e.role) live.role = e.role;
  if (e.branch) live.branch = e.branch;
  if (e.file) live.currentFile = e.file;
  if (e.command) live.currentCommand = e.command;
  if (e.tests) live.tests = { ...e.tests };
  if (e.kind === "EDITING_FILE" && e.file && !live.changedFiles.includes(e.file)) live.changedFiles.push(e.file);
  switch (e.kind) {
    case "TASK_STARTED": live.state = "running"; live.stage = "agent started"; break;
    case "PLANNING": if (e.text === "resumed") live.state = "running"; else live.stage = e.text.slice(0, 120); break;
    case "RUNNING_TEST": live.stage = live.state === "validating" ? "validating: tests" : "running tests"; break;
    case "EDITING_FILE": live.stage = "editing files"; break;
    case "BUILDING": live.stage = live.state === "validating" ? "validating: build" : "building"; break;
    case "SEARCHING": live.stage = "searching the code"; break;
    case "READING_FILE": live.stage = "reading files"; break;
    case "VALIDATING": live.state = "validating"; live.stage = "validating"; live.lastCheckpoint = "agent finished"; break;
    case "WAITING_USER": if (e.text === "paused") live.state = "paused"; break;
    case "POLICY_VIOLATION": live.stage = e.text.slice(0, 120); break;
    case "WARNING": if (e.text.startsWith("interrupted")) live.state = "interrupted_after_restart"; break;
    case "TASK_CANCELLED":
      if (e.role) { live.stage = `${e.role}: stopped`; break; } // one role of the factory, not the task
      live.state = "cancelled"; live.stage = "stopped"; break;
    case "TASK_COMPLETED": {
      if (e.role) { live.stage = `${e.role}: ${e.text.slice(0, 120)}`; live.lastCheckpoint = live.stage; break; }
      const truth = e.text.split(":")[0];
      live.state = truthState(truth);
      live.stage = e.text.slice(0, 160);
      live.lastCheckpoint = live.stage;
      break;
    }
    default: break;
  }
}

function truthState(truth: string): CoderTaskState {
  if (truth === "CONFIRMED" || truth === "ATTEMPTED") return "completed";
  if (truth === "BLOCKED" || truth === "NEEDS_CAPABILITY" || truth === "NEEDS_PERMISSION") return "blocked";
  return "failed";
}

export class CoderLiveStore {
  private live = new Map<string, CoderLiveState>();
  private logs = new Map<string, CoderEvent[]>();
  private results = new Map<string, CoderResult>();
  private diffs = new Map<string, string>();
  private shownDiff: string | null = null;
  private lastSeq = new Map<string, number>();
  private listeners = new Set<() => void>();
  private version = 0;
  private cached: CoderStoreSnapshot | null = null;
  private scheduled = false;
  /** Events applied (performance counters and tests). */
  applied = 0;

  constructor(private readonly o: { logLimit?: number; maxTasks?: number } = {}) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** A task JARVIS just started: known before its first event arrives. */
  begin(state: CoderLiveState): void {
    this.live.set(state.taskId, { ...state, changedFiles: [...state.changedFiles] });
    this.trim();
    this.changed();
  }

  /** Authoritative live states from the host (on connect, after a renderer reload). */
  seed(states: CoderLiveState[]): void {
    // Executor tasks ("code_x.coder") are shown under their kernel task ("code_x").
    for (const s of states) { const id = s.taskId.split(".")[0]; this.live.set(id, { ...s, taskId: id, changedFiles: [...s.changedFiles] }); }
    this.trim();
    this.changed();
  }

  /** A batch from the host: ring buffer, in-place state, one notification. */
  ingest(batch: CoderEvent[]): void {
    const cap = this.o.logLimit ?? 500;
    for (const e of batch) {
      // Same event twice (a replayed batch) is applied once.
      const last = this.lastSeq.get(e.taskId) ?? 0;
      if (e.seq <= last) continue;
      this.lastSeq.set(e.taskId, e.seq);
      // A role's events ("code_x.coder") belong to the kernel task ("code_x").
      const key = this.live.has(e.taskId) ? e.taskId : e.taskId.split(".")[0];
      let log = this.logs.get(key);
      if (!log) { log = []; this.logs.set(key, log); }
      log.push(e);
      if (log.length > cap * 2) log.splice(0, log.length - cap); // amortized trim
      const live = this.live.get(key);
      if (live) applyCoderEvent(live, e);
      this.applied++;
    }
    this.changed();
  }

  setResult(r: CoderResult): void {
    this.results.set(r.taskId, r);
    const live = this.live.get(r.taskId);
    if (live) {
      live.state = r.state;
      if (r.validation) live.changedFiles = [...r.validation.changedFiles];
    }
    this.changed();
  }

  /** The diff the user asked to see ("pokaż zmiany"), for the CODE view. */
  setDiff(taskId: string, diff: string): void {
    this.diffs.set(taskId, diff);
    this.shownDiff = taskId;
    this.changed();
  }

  diff(taskId: string): string | undefined {
    return this.diffs.get(taskId);
  }

  /** The task whose diff was asked for last (the CODE view opens it). */
  get diffTaskId(): string | null {
    return this.shownDiff;
  }

  get(taskId: string): CoderLiveState | undefined {
    return this.live.get(taskId);
  }

  result(taskId: string): CoderResult | undefined {
    return this.results.get(taskId);
  }

  /** The task the user most likely means: a live one, newest first. */
  current(): CoderLiveState | undefined {
    let best: CoderLiveState | undefined;
    for (const t of this.live.values()) if (LIVE_CODER_STATES.has(t.state) && (!best || t.startedAt >= best.startedAt)) best = t;
    return best;
  }

  latest(): CoderLiveState | undefined {
    let best: CoderLiveState | undefined;
    for (const t of this.live.values()) if (!best || t.startedAt >= best.startedAt) best = t;
    return best;
  }

  /** The last `limit` events of a task (for the readable log). */
  log(taskId: string, limit = 200): CoderEvent[] {
    const cap = this.o.logLimit ?? 500;
    const log = this.logs.get(taskId) ?? [];
    return log.slice(-Math.min(limit, cap));
  }

  snapshot(): CoderStoreSnapshot {
    if (this.cached && this.cached.version === this.version) return this.cached;
    const tasks = [...this.live.values()].sort((a, b) => b.startedAt - a.startedAt).map((t) => ({ ...t, changedFiles: [...t.changedFiles], tests: t.tests ? { ...t.tests } : undefined }));
    this.cached = { version: this.version, tasks, results: Object.fromEntries(this.results) };
    return this.cached;
  }

  private trim(): void {
    const max = this.o.maxTasks ?? 30;
    if (this.live.size <= max) return;
    const old = [...this.live.values()].filter((t) => !LIVE_CODER_STATES.has(t.state)).sort((a, b) => a.startedAt - b.startedAt);
    for (const t of old.slice(0, this.live.size - max)) {
      this.live.delete(t.taskId);
      this.logs.delete(t.taskId);
      this.results.delete(t.taskId);
      this.diffs.delete(t.taskId);
    }
  }

  private changed(): void {
    this.version++;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      for (const fn of [...this.listeners]) { try { fn(); } catch { /* a view's problem */ } }
    });
  }
}
