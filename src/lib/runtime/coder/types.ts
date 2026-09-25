// Coding agents under JARVIS (mission M11-M13). JARVIS is the operator; Codex CLI, Claude Code CLI
// or a local model are executors behind one contract. Everything here is shared by the Electron
// main process (which spawns the agents) and the renderer runtime (kernel task, panel, voice).
// Event text is always redacted before it leaves the main process; it is data, never commands.

export type CoderBackendId = "codex" | "claude" | "local" | "fake";

/** What JARVIS can honestly say about a backend without a paid call. */
export type BackendAvailability = "available" | "unavailable" | "needs_auth" | "ready" | "unknown_auth";

export interface BackendProbe {
  id: CoderBackendId;
  availability: BackendAvailability;
  version?: string;
  /** How authentication was established ("login status", "credentials file present"), never the secret. */
  authDetail?: string;
  /** Features the adapter can really use with this version. */
  supports: { json: boolean; resume: boolean; sendInstruction: boolean; pause: boolean };
  detail?: string;
}

export type CoderEventKind =
  | "TASK_STARTED"
  | "PLANNING"
  | "READING_FILE"
  | "SEARCHING"
  | "EDITING_FILE"
  | "RUNNING_COMMAND"
  | "RUNNING_TEST"
  | "BUILDING"
  | "GIT_OPERATION"
  | "WAITING_USER"
  | "MESSAGE"
  | "WARNING"
  | "ERROR"
  | "POLICY_VIOLATION"
  | "VALIDATING"
  | "CHECK_RESULT"
  | "TASK_COMPLETED"
  | "TASK_CANCELLED";

export interface CoderEvent {
  taskId: string;
  seq: number;
  at: number;
  kind: CoderEventKind;
  /** One readable, redacted line. */
  text: string;
  /** A workspace-relative file the step touches. */
  file?: string;
  /** A redacted command line. */
  command?: string;
  exitCode?: number;
  /** Tests seen in command output or a validation check (best effort, from the runner's summary). */
  tests?: { passed: number; failed: number };
  /** The agent's own session id (Codex thread, Claude session), for resume. */
  sessionId?: string;
  model?: string;
  /** The factory role of the task that produced the event (M13). */
  role?: string;
  /** On JARVIS's own TASK_STARTED: the backend really chosen and the branch it works on. */
  backend?: CoderBackendId;
  branch?: string;
}

/** Lifecycle of a coding task as seen by JARVIS (not by the agent). */
export type CoderTaskState =
  | "queued"
  | "starting"
  | "running"
  | "paused"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"
  | "interrupted_after_restart";

export const LIVE_CODER_STATES: ReadonlySet<CoderTaskState> = new Set(["queued", "starting", "running", "paused", "validating"]);

export type CostMode = "cheap" | "normal" | "max";
export type BackendChoice = "auto" | "codex" | "claude" | "local";

export interface CoderTaskSpec {
  /** Stable id (the kernel task id): the same id twice is the same task (dedup). */
  taskId: string;
  goal: string;
  /** The user's own words for the whole task (a role's goal adds a plan or a failure to it). */
  title?: string;
  workspaceId: string;
  backend: BackendChoice;
  /** "no release", "run the tests first": enforced by the guard and told to the agent. */
  constraints?: string[];
  /** read-only for planning/review roles, write for coding roles. */
  access?: "read" | "write";
  /** Work on a jarvis/<task>-<slug> branch (large autonomous tasks). */
  branch?: boolean;
  /** Resume from the current repo state after an interruption. */
  resumeOf?: string;
  /**
   * Measure changes from another task's starting point (its HEAD and the user's dirty files), in
   * a fresh agent session: a debugger or a fix after review counts the whole factory's changes.
   */
  baseOf?: string;
  /** Role inside the software factory (M13); plain tasks are "coder". */
  role?: "planner" | "coder" | "tester" | "reviewer" | "debugger";
  timeoutMs?: number;
}

export interface GitSnapshot {
  isRepo: boolean;
  branch?: string;
  head?: string;
  upstream?: string;
  remote?: string;
  /** `git status --short` lines at the time of the snapshot. */
  dirty: string[];
}

export interface CheckResult {
  name: string;
  /** The exact command JARVIS ran (taken from the repo, never invented). */
  command: string;
  exitCode: number;
  ok: boolean;
  durationMs: number;
  tests?: { passed: number; failed: number };
  /** Last lines of output, redacted. */
  tail: string;
}

export interface ValidationResult {
  ran: boolean;
  checks: CheckResult[];
  /** No check could be found in the repo: nothing proves the change. */
  noChecks: boolean;
  diffStat: string;
  changedFiles: string[];
  /** Files that were already dirty before the task and are changed again (never auto-committed). */
  overlapsUserChanges: string[];
  historyIntact: boolean;
  /** Files that define the checks (scripts, test config) the agent changed: no CONFIRMED then. */
  checksChanged?: string[];
}

export interface CoderResult {
  taskId: string;
  state: CoderTaskState;
  /** Final truth (kernel truth states). CONFIRMED only after independent validation passed. */
  truth: "CONFIRMED" | "FAILED" | "BLOCKED" | "NEEDS_CAPABILITY" | "NEEDS_PERMISSION" | "UNKNOWN_AFTER_ATTEMPT" | "ATTEMPTED";
  /** Some required checks passed and some failed. */
  partial?: boolean;
  backend: CoderBackendId;
  agentSaysDone: boolean;
  agentSummary?: string;
  validation?: ValidationResult;
  violations: string[];
  reason?: string;
  sessionId?: string;
  /** How the agent's run ended (completed, crashed, timeout, ...), apart from the verdict. */
  ended?: "completed" | "cancelled" | "crashed" | "timeout" | "unavailable" | "needs_auth" | "blocked";
}

/** Persisted per task (checkpoints), with process metadata but no secrets. */
export interface CoderTaskRecord {
  taskId: string;
  goal: string;
  /** The user's words for the whole task (what "kontynuuj" continues). */
  title?: string;
  backend: CoderBackendId;
  workspaceId: string;
  root: string;
  state: CoderTaskState;
  startedAt: number;
  updatedAt: number;
  startHead?: string;
  currentHead?: string;
  branch?: string;
  dirtyBefore: string[];
  /** Content hashes of the files dirty before the task (to tell the user's changes from the agent's). */
  dirtyHashes?: Record<string, string>;
  changedFiles: string[];
  lastStage?: string;
  lastTests?: { passed: number; failed: number };
  pid?: number;
  /** When that process started (Linux /proc), so a reused pid is never killed after a restart. */
  pidStart?: string;
  /** Fingerprint of how the repo checks itself (scripts, test config) when the task started. */
  checksPrint?: string;
  sessionId?: string;
  constraints: string[];
  /** The task that continued this one after an interruption (it is not offered again). */
  resumedBy?: string;
  /** Roles of the factory already CONFIRMED (never run again on resume). */
  confirmedRoles?: string[];
  result?: CoderResult;
}

/** Live view of one task for the panel and for "co teraz robisz?" (from structured events only). */
export interface CoderLiveState {
  taskId: string;
  goal: string;
  backend: CoderBackendId;
  model?: string;
  workspace: string;
  branch?: string;
  state: CoderTaskState;
  stage?: string;
  currentFile?: string;
  currentCommand?: string;
  changedFiles: string[];
  tests?: { passed: number; failed: number };
  startedAt: number;
  lastCheckpoint?: string;
  dirty: number;
  role?: string;
}
