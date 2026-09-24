// Shared runtime state types: tasks, actions, referents, consent, perception.

import type { Provenance } from "./provenance";
import type { Truth } from "./truth";

// ---------------------------------------------------------------- referents (mission 5.3)

export type ReferentType =
  | "Window" | "Tab" | "Page" | "Element" | "Collection" | "TextRange" | "Selection"
  | "Clipboard" | "Contact" | "Email" | "File" | "Task" | "ConversationTopic";

/** Types bound to what is on screen; a navigation or major DOM change invalidates them. */
export const SCREEN_BOUND: ReadonlySet<ReferentType> = new Set<ReferentType>([
  "Page", "Element", "Collection", "TextRange", "Selection",
]);

export interface Referent {
  id: string;
  type: ReferentType;
  /** Environment or lane that produced it ("managed-browser", "linux-desktop", "user", ...). */
  source: string;
  /** observationEpoch at creation or last verification. */
  epoch: number;
  /** Invalidation scope (usually the page or window id it lives in). */
  scope?: string;
  /** Stable semantic key, e.g. "comment:3" or "page:https://example.test/watch?v=1". */
  semanticKey: string;
  confidence: number;
  salience: number;
  createdAt: number;
  lastMentioned?: number;
  lastActed?: number;
  parent?: string;
  metadata: Record<string, unknown>;
  /** Proof of the last verification (read-back summary). */
  evidence?: string;
  provenance?: Provenance;
  valid: boolean;
  invalidatedReason?: string;
}

export interface CollectionMeta {
  items: string[];
  /** -1 = no item selected yet. */
  cursor: number;
  rejected: string[];
  /** Semantic item kind, e.g. "comment". */
  itemKind: string;
}

export interface ReferentRegistry {
  byId: Record<string, Referent>;
  /** Collection id -> cursor state. */
  collections: Record<string, CollectionMeta>;
  /** Most recent first; bounded. */
  recent: string[];
}

// ---------------------------------------------------------------- tasks and actions

export type TaskStatus = "running" | "paused" | "waiting_consent" | "blocked" | "done" | "failed" | "cancelled";

/** "blocked" ends a task too: a missing precondition or a refusal is final for that task. */
export const TERMINAL_TASK: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["done", "failed", "cancelled", "blocked"]);

export interface TaskStep {
  id: string;
  intent: string;
  status: "pending" | "running" | Truth;
  actionId?: string;
  evidence?: string;
}

export interface UndoRecord {
  actionId: string;
  kind: string;
  /** Data needed by the environment to reverse the action (e.g. previous scrollY). */
  data: Record<string, unknown>;
}

export interface TaskState {
  id: string;
  goal: string;
  kind: string;
  status: TaskStatus;
  statusReason?: string;
  /** While paused: the live status to return to on resume (running or waiting_consent). */
  pausedFrom?: TaskStatus;
  createdAt: number;
  updatedAt: number;
  parentId?: string;
  steps: TaskStep[];
  currentStepId?: string;
  referents: string[];
  idempotencyKeys: string[];
  undo: UndoRecord[];
  lastError?: string;
}

export type ActionStatus = "started" | Truth;

export interface ActionRecord {
  id: string;
  taskId: string;
  stepId?: string;
  kind: string;
  argsHash: string;
  idempotencyKey?: string;
  status: ActionStatus;
  startedAt: number;
  endedAt?: number;
  evidence?: string;
  reason?: string;
  /** True when the action has an external side effect (mail, SMS, purchase). */
  external: boolean;
}

export interface ConsentRecord {
  id: string;
  taskId: string;
  actionId?: string;
  summary: string;
  /** Final arguments shown to the user (already redacted for display). */
  args: Record<string, string>;
  status: "pending" | "granted" | "denied";
  requestedAt: number;
  decidedAt?: number;
}

// ---------------------------------------------------------------- perception

export interface PageState {
  id: string;
  url: string;
  title: string;
  scrollY?: number;
  epoch: number;
}

export interface WindowState {
  id: string;
  app: string;
  title: string;
}

export interface ClipboardState {
  /** Hash of the clipboard text (never the full text in durable storage). */
  hash: string;
  preview: string;
  byJarvis: boolean;
  /** Hash JARVIS last wrote, to detect external changes after "skopiuj". */
  jarvisHash?: string;
  at: number;
  provenance: Provenance;
}

export type CapabilityStatus = "available" | "degraded" | "needs_permission" | "needs_hardware" | "missing" | "unknown";

export interface CapabilityState {
  id: string;
  status: CapabilityStatus;
  detail?: string;
  provider?: string;
  checkedAt: number;
}
