// Coding tasks inside the JARVIS runtime (M12). A coding command becomes an ordinary kernel task
// (kind "code", one action "coder.run"), so "stop", "pauza", "wznów" and the focus stack reach it
// like any other task: the kernel changes the task's status and this controller carries the change
// to the agent process. The action lane's serial queue is never blocked by a coding agent.
// Answers come from structured state only: the live store and the executor's result.

import type { Kernel } from "../kernel";
import type { TaskStatus } from "../types";
import { TERMINAL_TASK } from "../types";
import { hashArgs, preview } from "../util";
import { parseCoderIntent, type CoderIntent } from "./intent";
import { CoderLiveStore } from "./live";
import { matchWorkspace } from "./match";
import { coderCall, type CoderPort, type WorkspaceInfo } from "./port";
import type { BackendChoice, CoderBackendId, CoderLiveState, CoderResult, CoderTaskRecord, CoderTaskSpec, CostMode } from "./types";
import { LIVE_CODER_STATES } from "./types";

export interface CoderSettings {
  backend: BackendChoice;
  mode: CostMode;
}

export interface CoderControllerOptions {
  kernel: Kernel;
  port: CoderPort;
  store?: CoderLiveStore;
  /** Speak (through the runtime, so "stop" silences it and history quotes it as data). */
  say: (text: string, utteranceId?: string) => void;
  settings?: () => CoderSettings;
  now?: () => number;
  /**
   * Plan the task before it starts (M13 software factory). Returns the result of the whole run;
   * without it a task is one agent run followed by independent validation.
   */
  runTask?: (ctx: CoderRunContext) => Promise<CoderResult>;
}

/**
 * What a task run gets. `spec.taskId` is the kernel task id; every agent run inside it gets its own
 * executor task id `<kernel task id>.<role>` (separate context, separate record).
 */
export interface CoderRunContext {
  spec: CoderTaskSpec;
  port: CoderPort;
  settings: CoderSettings;
  kernel: Kernel;
  /** The kernel task was cancelled (stop). */
  signal: AbortSignal;
  /** The executor task that stop / pause / "dodaj jeszcze" / diff should reach now. */
  setActive(execId: string): void;
  /** Continue after a restart: the interrupted executor record and everything done before it. */
  resume?: { prior: CoderTaskRecord; history: CoderTaskRecord[] };
}

/** Kernel task id of an executor task id ("code_x.coder" -> "code_x"). */
export const parentTaskId = (execId: string): string => execId.split(".")[0];

/** One agent run with independent validation: the task without the software factory. */
export async function plainRun(ctx: CoderRunContext): Promise<CoderResult> {
  const execId = ctx.resume ? `${ctx.resume.prior.taskId}-r` : `${ctx.spec.taskId}.agent`;
  ctx.setActive(execId);
  const r = await coderCall(ctx.port, { method: "start", spec: { ...ctx.spec, taskId: execId, resumeOf: ctx.resume?.prior.taskId } });
  return { ...r, taskId: ctx.spec.taskId };
}

export interface CoderTurn {
  route: "coder";
  say?: string;
  taskId?: string;
  intent: CoderIntent["kind"];
}

const BACKEND_NAME: Record<CoderBackendId, string> = { codex: "Codex", claude: "Claude Code", local: "Lokalny model", fake: "Agent testowy" };
const STATE_PL: Record<string, string> = {
  queued: "czeka", starting: "startuje", running: "pracuje", paused: "jest wstrzymany", validating: "sprawdzam wynik niezależnie",
  completed: "skończył", failed: "skończył z błędem", cancelled: "przerwany", blocked: "zablokowany", interrupted_after_restart: "przerwany restartem",
};
const ROLE_PL: Record<string, string> = { planner: "planista", coder: "programista", tester: "tester", debugger: "debugger", reviewer: "recenzent" };
const STAGE_PL: Record<string, string> = {
  "choosing a backend": "wybieram agenta", "agent started": "agent zaczął", "running tests": "uruchamia testy", "editing files": "edytuje pliki",
  building: "buduje", "searching the code": "przeszukuje kod", "reading files": "czyta pliki", validating: "niezależna walidacja",
  "validating: tests": "niezależne testy", "validating: build": "niezależny build", "resuming from the current state": "wznawia od obecnego stanu",
  "agent finished": "agent skończył", stopped: "przerwane",
};

const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const files = (n: number) => `${n} ${plural(n, "plik", "pliki", "plików")}`;

export class CoderController {
  readonly store: CoderLiveStore;
  private readonly kernel: Kernel;
  private readonly port: CoderPort;
  private readonly now: () => number;
  private workspaces: WorkspaceInfo[] = [];
  private interrupted: CoderTaskRecord[] = [];
  private historyCache: CoderTaskRecord[] = [];
  /** Kernel task id -> its coding run. */
  private runs = new Map<string, { actionId: string; utteranceId: string; ws: WorkspaceInfo; controller: AbortController; execId: string }>();
  /** Kernel task id -> the executor task that ran last (for the diff after the end). */
  private lastExec = new Map<string, string>();
  private lastStatus = new Map<string, TaskStatus>();
  private pending = new Set<Promise<void>>();
  private unsubscribe: (() => void)[] = [];
  readonly ready: Promise<void>;

  constructor(private readonly o: CoderControllerOptions) {
    this.kernel = o.kernel;
    this.port = o.port;
    this.store = o.store ?? new CoderLiveStore();
    this.now = o.now ?? (() => Date.now());
    this.unsubscribe.push(this.port.onEvents((b) => this.store.ingest(b)));
    this.unsubscribe.push(this.kernel.subscribe((s) => this.onKernel(s.tasks)));
    this.ready = this.refresh();
  }

  dispose(): void {
    for (const u of this.unsubscribe.splice(0)) u();
  }

  private settings(): CoderSettings {
    return this.o.settings?.() ?? { backend: "auto", mode: "normal" };
  }

  /** Projects, interrupted tasks and live states from the host (at start and after changes). */
  async refresh(): Promise<void> {
    const [ws, hist, live] = await Promise.all([
      this.port.call({ method: "workspaces" }), this.port.call({ method: "history" }), this.port.call({ method: "live" }),
    ]);
    if (ws.ok) this.workspaces = ws.value;
    if (hist.ok) {
      this.historyCache = hist.value;
      this.interrupted = hist.value.filter((r) => r.state === "interrupted_after_restart" && !r.resumedBy);
    }
    if (live.ok) this.store.seed(live.value);
  }

  /** Resolves when every coding run started here has finished (tests). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private ctx() {
    const cur = this.store.current();
    return { live: !!cur && this.runs.has(cur.taskId), any: !!this.store.latest(), interrupted: this.interrupted.length > 0 };
  }

  /** Would the runtime give this utterance to the coder (no side effects)? */
  claims(text: string): boolean {
    const i = parseCoderIntent(text, this.ctx());
    if (!i) return false;
    if (i.kind === "continue") return !this.pausedKernelTask();
    if (i.kind !== "start") return true;
    return !!matchWorkspace(this.workspaces, text) || i.explicit;
  }

  private pausedKernelTask(): boolean {
    return Object.values(this.kernel.state.tasks).some((t) => t.status === "paused");
  }

  /** Route one utterance; null leaves it to the rest of the runtime. */
  handle(utteranceId: string, text: string): CoderTurn | null {
    if (!this.claims(text)) return null;
    const i = parseCoderIntent(text, this.ctx())!;
    const cur = this.store.current();
    switch (i.kind) {
      case "start": return this.start(utteranceId, text, i);
      case "continue": return this.continueInterrupted(utteranceId, text);
      case "status": return this.reply(i.kind, utteranceId, this.statusLine() ?? "Żaden agent teraz nie pracuje.");
      case "diff": return this.showDiff(utteranceId);
      case "stop": case "pause": case "resume": {
        if (!cur) return this.reply(i.kind, utteranceId, "Żaden agent teraz nie pracuje.");
        this.kernel.dispatch({ type: "ControlIntent", control: i.kind, tier: i.kind === "resume" ? 1 : 0, utteranceId, taskId: cur.taskId });
        if (i.kind === "stop") return { route: "coder", intent: i.kind, taskId: cur.taskId }; // silence
        return this.reply(i.kind, utteranceId, i.kind === "pause" ? "Wstrzymuję agenta." : "Agent wraca do pracy.", cur.taskId);
      }
      case "constraint": case "instruction": return this.amend(utteranceId, text, i);
    }
  }

  private reply(intent: CoderIntent["kind"], utteranceId: string, say: string, taskId?: string): CoderTurn {
    this.o.say(say, utteranceId);
    return { route: "coder", intent, say, taskId };
  }

  // ---------------------------------------------------------------------------------- start

  private start(utteranceId: string, text: string, i: Extract<CoderIntent, { kind: "start" }>): CoderTurn {
    const ws = matchWorkspace(this.workspaces, text);
    if (!ws) return this.reply("start", utteranceId, this.workspaces.length
      ? `Nie wiem, w którym projekcie. Znam: ${this.workspaces.slice(0, 4).map((w) => w.name).join(", ")}.`
      : "Nie mam jeszcze żadnego projektu. Dodaj folder w zakładce KOD, wtedy zacznę.");
    const settings = this.settings();
    const backend = i.backend ?? settings.backend;
    return this.launch(utteranceId, text, { goal: i.goal, ws, backend, access: i.access });
  }

  /**
   * "kontynuuj" after a restart: the same kernel task (restored from the journal, or recreated),
   * the agent's own session resumed from the current repository state.
   */
  private continueInterrupted(utteranceId: string, text: string): CoderTurn {
    const prior = this.interrupted[0];
    const ws = this.workspaces.find((w) => w.id === prior.workspaceId);
    if (!ws) return this.reply("continue", utteranceId, "Projekt przerwanego zadania nie jest już dodany do JARVIS-a.");
    this.interrupted = this.interrupted.slice(1);
    const backend: BackendChoice = prior.backend === "fake" ? "auto" : prior.backend;
    const goal = this.kernel.state.tasks[parentTaskId(prior.taskId)]?.goal ?? prior.title ?? prior.goal;
    return this.launch(utteranceId, text, { goal, ws, backend, access: "write", resume: prior, constraints: prior.constraints, taskId: parentTaskId(prior.taskId) });
  }

  private launch(utteranceId: string, text: string, t: { goal: string; ws: WorkspaceInfo; backend: BackendChoice; access: "read" | "write"; resume?: CoderTaskRecord; constraints?: string[]; taskId?: string }): CoderTurn {
    const k = this.kernel;
    // One run per utterance, even if the same words arrive twice.
    const key = `code:${utteranceId}`;
    if (k.state.idempotency[key]) return { route: "coder", intent: "start", taskId: k.state.actions[k.state.idempotency[key]]?.taskId };
    const taskId = t.taskId ?? k.id("code");
    const actionId = k.id("act");
    k.dispatch({ type: "ConversationIntent", intent: t.resume ? "RESUME" : "NEW_TASK", text, utteranceId, taskId });
    const existing = k.state.tasks[taskId];
    if (existing && !TERMINAL_TASK.has(existing.status)) {
      // Restored from the journal (paused after the restart): the user's "kontynuuj" resumes it.
      if (existing.status === "paused") k.dispatch({ type: "TaskStatusChanged", taskId, status: "running", reason: "control:resume", control: true });
    } else {
      k.dispatch({ type: "TaskCreated", taskId, goal: t.goal, kind: "code", steps: [{ id: "agent", intent: "agent pracuje w projekcie" }, { id: "validate", intent: "niezależna walidacja" }] });
    }
    const started = k.dispatch({ type: "ActionStarted", actionId, taskId, stepId: "agent", kind: "coder.run", argsHash: hashArgs({ goal: t.goal, ws: t.ws.id }), idempotencyKey: key });
    if (!started.accepted) {
      k.dispatch({ type: "TaskCancelled", taskId, reason: "duplicate command" });
      return { route: "coder", intent: "start" };
    }
    k.dispatch({ type: "TaskStepChanged", taskId, stepId: "agent", status: "running" });
    const controller = new AbortController();
    const run = { actionId, utteranceId, ws: t.ws, controller, execId: `${taskId}.agent` };
    this.runs.set(taskId, run);
    this.lastStatus.set(taskId, k.state.tasks[taskId]?.status ?? "running");
    this.store.begin({ taskId, goal: t.goal, backend: t.backend === "auto" ? "codex" : t.backend, workspace: t.ws.name, state: "starting", changedFiles: [], startedAt: this.now(), dirty: 0, stage: "choosing a backend" });
    const spec: CoderTaskSpec = { taskId, goal: t.goal, title: t.goal, workspaceId: t.ws.id, backend: t.backend, access: t.access, constraints: t.constraints };
    const say = t.resume
      ? `Wracam do „${preview(t.goal, 60)}” w ${t.ws.name}. Zaczynam od obecnego stanu repozytorium, nie powtarzam tego, co już zrobione.`
      : `Zaczynam w ${t.ws.name}: „${preview(t.goal, 60)}”. ${t.access === "read" ? "Tylko czytam, nic nie zmieniam." : "Po pracy agenta sam sprawdzę testy."}`;
    this.o.say(say, utteranceId);
    const ctx: CoderRunContext = {
      spec, port: this.port, settings: this.settings(), kernel: k, signal: controller.signal,
      setActive: (execId) => { run.execId = execId; this.lastExec.set(taskId, execId); },
      resume: t.resume ? { prior: t.resume, history: this.historyCache } : undefined,
    };
    const p = (this.o.runTask ?? plainRun)(ctx)
      .then((r) => this.finish(taskId, r))
      .catch((e) => this.finish(taskId, { taskId, state: "failed", truth: "FAILED", backend: "codex", agentSaysDone: false, violations: [], reason: e instanceof Error ? e.message : String(e) }))
      .finally(() => { this.pending.delete(p); });
    this.pending.add(p);
    return { route: "coder", intent: "start", say, taskId };
  }

  private finish(taskId: string, r: CoderResult): void {
    const run = this.runs.get(taskId);
    if (!run) return;
    this.runs.delete(taskId);
    this.store.setResult(r);
    const k = this.kernel;
    const evidence = checksLine(r);
    // The plain run's two steps; the factory reports its role steps itself.
    const has = (id: string) => !!k.state.tasks[taskId]?.steps.some((x) => x.id === id);
    if (has("agent")) k.dispatch({ type: "TaskStepChanged", taskId, stepId: "agent", status: r.agentSaysDone ? "ATTEMPTED" : r.truth === "CONFIRMED" ? "CONFIRMED" : r.truth, evidence: r.agentSummary ? preview(r.agentSummary, 200) : undefined });
    if (has("validate") && r.validation?.ran) k.dispatch({ type: "TaskStepChanged", taskId, stepId: "validate", status: r.truth === "CONFIRMED" ? "CONFIRMED" : "FAILED", evidence });
    if (r.truth === "CONFIRMED") k.dispatch({ type: "ActionVerified", actionId: run.actionId, evidence: evidence || "read-only report received, no file changed" });
    else if (r.truth === "ATTEMPTED") k.dispatch({ type: "ActionAttempted", actionId: run.actionId, evidence: r.reason });
    else k.dispatch({ type: "ActionFailed", actionId: run.actionId, reason: r.reason ?? r.state, truth: r.truth });
    const status = k.state.tasks[taskId]?.status;
    if (status && !TERMINAL_TASK.has(status)) {
      if (r.state === "interrupted_after_restart") return;
      k.dispatch({ type: "TaskStatusChanged", taskId, status: r.truth === "CONFIRMED" ? "done" : r.state === "blocked" ? "blocked" : r.truth === "ATTEMPTED" ? "done" : "failed", reason: r.reason });
    }
    // "stop" means silence; everything else is said, with what was really checked.
    if (r.state !== "cancelled" && k.state.tasks[taskId]?.status !== "cancelled") this.o.say(resultSay(r, run.ws.name), run.utteranceId);
  }

  // --------------------------------------------------------------------- kernel -> process

  /** Carry the kernel's status of a coding task (stop, pause, resume) to the agent process. */
  private onKernel(tasks: Record<string, { status: TaskStatus }>): void {
    for (const [taskId, run] of this.runs) {
      const now = tasks[taskId]?.status;
      const before = this.lastStatus.get(taskId);
      if (!now || now === before) continue;
      this.lastStatus.set(taskId, now);
      if (now === "cancelled") {
        run.controller.abort();
        void this.port.call({ method: "cancel", taskId: run.execId });
      } else if (now === "paused") {
        void this.port.call({ method: "pause", taskId: run.execId }).then((r) => {
          if (r.ok && r.value) return;
          // This agent cannot be paused: say so and keep the task honest (still running).
          this.kernel.dispatch({ type: "TaskStatusChanged", taskId, status: "running", reason: "the agent cannot pause", control: true });
          this.o.say("Tego agenta nie da się wstrzymać, pracuje dalej. Powiedz stop, jeśli mam go przerwać.", run.utteranceId);
        });
      } else if (now === "running" && before === "paused") {
        void this.port.call({ method: "resume", taskId: run.execId });
      }
    }
  }

  // -------------------------------------------------------------------------------- amend

  private amend(utteranceId: string, text: string, i: Extract<CoderIntent, { kind: "constraint" | "instruction" }>): CoderTurn {
    const cur = this.store.current()!;
    const change = i.kind === "constraint" ? { constraint: i.constraint } : { instruction: i.instruction };
    this.kernel.dispatch({ type: "ConversationIntent", intent: "AMEND_TASK", text, utteranceId, taskId: cur.taskId });
    this.kernel.dispatch({ type: "TaskAmended", taskId: cur.taskId, change: i.kind === "constraint" ? i.constraint : i.instruction });
    const turn: CoderTurn = { route: "coder", intent: i.kind, taskId: cur.taskId };
    const p = coderCall(this.port, { method: "amend", taskId: this.execOf(cur.taskId), ...change })
      .then((r) => {
        turn.say = !r.ok ? "Zadanie już się skończyło, nie mam czego zmienić."
          : i.kind === "constraint" ? `Dobrze: ${i.constraint}. Pilnuję tego do końca zadania.`
          : r.delivered === "now" ? `Przekazałem agentowi: „${preview(i.instruction, 60)}”.`
          : `Dodam to, gdy agent skończy obecny krok: „${preview(i.instruction, 60)}”.`;
      })
      .catch(() => { turn.say = "Nie udało mi się tego przekazać agentowi."; })
      .then(() => { this.o.say(turn.say!, utteranceId); })
      .finally(() => { this.pending.delete(p); });
    this.pending.add(p);
    return turn;
  }

  // ------------------------------------------------------------------------------- UI (KOD)

  /** START from the CODE screen: the same kernel task as a spoken command. */
  startTask(goal: string, workspaceId: string, o: { backend?: BackendChoice; access?: "read" | "write" } = {}): CoderTurn {
    const ws = this.workspaces.find((w) => w.id === workspaceId);
    const utteranceId = `ui-${this.kernel.id("u")}`;
    if (!ws || !goal.trim()) return this.reply("start", utteranceId, ws ? "Napisz, co agent ma zrobić." : "Wybierz projekt.");
    return this.launch(utteranceId, goal, { goal: goal.trim(), ws, backend: o.backend ?? this.settings().backend, access: o.access ?? "write" });
  }

  /** STOP / PAUZA / WZNÓW buttons: the kernel control path, like the spoken words. */
  control(taskId: string, control: "stop" | "pause" | "resume"): void {
    this.kernel.dispatch({ type: "ControlIntent", control, tier: control === "resume" ? 1 : 0, taskId });
  }

  /** POKAŻ ZMIANY for one task. */
  async loadDiff(taskId: string): Promise<string> {
    const d = await coderCall(this.port, { method: "diff", taskId: this.execOf(taskId) });
    this.store.setDiff(taskId, d);
    return d;
  }

  /** Which coding agents exist and whether they are logged in; also recorded as kernel capabilities. */
  async probe() {
    const probes = await coderCall(this.port, { method: "probe" });
    const at = this.now();
    const status = (a: string) => (a === "ready" ? "available" : a === "unknown_auth" ? "degraded" : a === "needs_auth" ? "needs_permission" : "missing") as "available" | "degraded" | "needs_permission" | "missing";
    this.kernel.dispatch({
      type: "CapabilitiesUpdated",
      capabilities: probes.map((p) => ({ id: `coder.${p.id}`, status: status(p.availability), provider: p.version, detail: p.availability === "needs_auth" ? p.authDetail : p.detail, checkedAt: at })),
    });
    return probes;
  }

  async history(): Promise<CoderTaskRecord[]> {
    return coderCall(this.port, { method: "history" });
  }

  listWorkspaces(): WorkspaceInfo[] {
    return [...this.workspaces];
  }

  /** The system folder picker (desktop): the renderer never names a path itself. */
  async pickWorkspace(): Promise<WorkspaceInfo | null> {
    const r = await this.port.call({ method: "pickWorkspace" });
    await this.refresh();
    return r.ok ? r.value : null;
  }

  async removeWorkspace(id: string): Promise<boolean> {
    const r = await this.port.call({ method: "removeWorkspace", id });
    await this.refresh();
    return r.ok && r.value;
  }

  async openWorkspace(id: string): Promise<boolean> {
    const r = await this.port.call({ method: "openWorkspace", id });
    return r.ok && r.value;
  }

  /** The executor task behind a kernel coding task (the one running now, or the last one). */
  private execOf(taskId: string): string {
    return this.runs.get(taskId)?.execId ?? this.lastExec.get(taskId) ?? `${taskId}.agent`;
  }

  // --------------------------------------------------------------------------- status, diff

  /** "Co teraz robi?": built from the live state the agent's own events produced, never guessed. */
  statusLine(taskId?: string): string | null {
    const t = taskId ? this.store.get(taskId) : this.store.current();
    if (!t) return null;
    return describe(t, this.now());
  }

  /** Live coding tasks (for the runtime's general status answer). */
  liveTasks(): CoderLiveState[] {
    return this.store.snapshot().tasks.filter((t) => LIVE_CODER_STATES.has(t.state));
  }

  private showDiff(utteranceId: string): CoderTurn {
    const t = this.store.current() ?? this.store.latest();
    if (!t) return this.reply("diff", utteranceId, "Nie mam żadnych zmian do pokazania.");
    const turn: CoderTurn = { route: "coder", intent: "diff", taskId: t.taskId };
    const p = coderCall(this.port, { method: "diff", taskId: this.execOf(t.taskId) })
      .then((d) => {
        this.store.setDiff(t.taskId, d);
        const n = t.changedFiles.length;
        turn.say = d.trim() ? `Pokazuję zmiany w zakładce KOD${n ? `: ${files(n)}` : ""}.` : "Na razie nie ma żadnych zmian.";
      })
      .catch(() => { turn.say = "Nie udało się odczytać zmian."; })
      .then(() => { this.o.say(turn.say!, utteranceId); })
      .finally(() => { this.pending.delete(p); });
    this.pending.add(p);
    return turn;
  }
}

function describe(t: CoderLiveState, now: number): string {
  const who = BACKEND_NAME[t.backend] ?? t.backend;
  const parts = [`${who} ${STATE_PL[t.state] ?? t.state}: „${preview(t.goal, 50)}” w ${t.workspace}${t.branch ? ` (gałąź ${t.branch})` : ""}.`];
  if (t.role && LIVE_CODER_STATES.has(t.state)) parts.push(`Rola: ${ROLE_PL[t.role] ?? t.role}.`);
  if (t.stage && LIVE_CODER_STATES.has(t.state)) parts.push(`Etap: ${STAGE_PL[t.stage] ?? `«${preview(t.stage, 60)}»`}.`);
  if (LIVE_CODER_STATES.has(t.state)) {
    if (t.currentCommand && (t.stage === "running tests" || t.stage === "building" || t.state === "validating")) parts.push(`Polecenie: ${preview(t.currentCommand, 50)}.`);
    else if (t.currentFile) parts.push(`Plik: ${t.currentFile}.`);
  }
  parts.push(t.changedFiles.length ? `Zmienione: ${files(t.changedFiles.length)}.` : "Jeszcze nic nie zmienił.");
  if (t.tests) parts.push(`Testy: ${t.tests.passed} ${plural(t.tests.passed, "przeszedł", "przeszły", "przeszło")}, ${t.tests.failed} nie.`);
  const min = Math.floor((now - t.startedAt) / 60_000);
  if (LIVE_CODER_STATES.has(t.state)) parts.push(min ? `Od ${min} min.` : "Od niecałej minuty.");
  return parts.join(" ");
}

function checksLine(r: CoderResult): string {
  const v = r.validation;
  if (!v?.ran || !v.checks.length) return "";
  return v.checks.map((c) => `${c.name} ${c.ok ? "PASS" : "FAIL"}${c.tests ? ` (${c.tests.passed}/${c.tests.passed + c.tests.failed})` : ""}`).join(", ");
}

/** What JARVIS says at the end: never "gotowe" without passing checks. */
export function resultSay(r: CoderResult, ws: string): string {
  const who = BACKEND_NAME[r.backend] ?? r.backend;
  const n = r.validation?.changedFiles.length ?? 0;
  const failedChecks = r.validation?.checks.filter((c) => !c.ok).map((c) => c.name) ?? [];
  switch (r.truth) {
    case "CONFIRMED":
      return r.validation?.ran
        ? `Gotowe i sprawdzone w ${ws}: ${checksLine(r)}. Zmienione: ${files(n)}.`
        : `Analiza gotowa. Słowa agenta: «${preview(r.agentSummary ?? "brak raportu", 300)}»`;
    case "ATTEMPTED":
      return r.validation?.noChecks
        ? `${who} skończył i zmienił ${files(n)}, ale projekt nie ma testów ani builda, więc nie mogę tego potwierdzić.`
        : `${who} coś zmienił (${files(n)}), ale nie potwierdziłem wyniku.`;
    case "FAILED":
      if (failedChecks.length) return `${r.agentSaysDone ? `${who} mówi, że skończył, ale` : "Nie przechodzi:"} ${failedChecks.join(", ")} ${failedChecks.length === 1 ? "nie przechodzi" : "nie przechodzą"}. Nie uznaję tego za gotowe.${r.partial ? " Część sprawdzeń przeszła." : ""}`;
      return `Nie udało się: ${r.reason ?? "agent skończył z błędem"}.${n ? ` Zostało ${files(n)} zmienionych, nic nie cofałem.` : ""}`;
    case "BLOCKED":
      return r.violations.length ? `Zatrzymałem agenta, bo próbował zrobić coś zabronionego: ${r.violations.join(", ")}.` : `Nie mogę zacząć: ${r.reason ?? "zablokowane"}.`;
    case "NEEDS_CAPABILITY":
      return "Nie mam agenta do kodu. Zainstaluj Codex CLI albo Claude Code, albo uruchom Ollamę z modelem do kodu.";
    case "NEEDS_PERMISSION":
      return `${who} wymaga zalogowania. Zaloguj się w terminalu (na przykład: codex login), potem spróbuj jeszcze raz.`;
    case "UNKNOWN_AFTER_ATTEMPT":
      return `Agent przerwał pracę w połowie (${r.reason ?? "bez powodu"}). Zmienione: ${files(n)}. Stan niepewny, sprawdź zmiany.`;
  }
}
