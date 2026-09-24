// Typed kernel event stream (mission 5.1). Every event has an id (dedup key) and a timestamp.
// Lanes never mutate state directly: they dispatch events and the kernel reduces them.

import type { Provenance } from "./provenance";
import type { Truth } from "./truth";
import type { CapabilityState, Referent, TaskStatus, UndoRecord } from "./types";

interface Base {
  /** Unique id; a repeated id is dropped by the kernel (dedup). */
  id: string;
  at: number;
}

export type ControlKind = "stop" | "pause" | "resume" | "cancel" | "undo" | "next" | "previous" | "confirm" | "reject";

export type ConversationIntentKind = "NEW_TASK" | "AMEND_TASK" | "PAUSE" | "RESUME" | "CANCEL" | "CONFIRM" | "SIDE_CHAT";

export interface SpeechPartial extends Base {
  type: "SpeechPartial";
  utteranceId: string;
  text: string;
  /** 0..1, how stable the partial is (provider or local estimate). */
  stability: number;
  /** VAD says this is user speech, not TTS echo. */
  userSpeech: boolean;
}

export interface SpeechFinal extends Base {
  type: "SpeechFinal";
  utteranceId: string;
  text: string;
  confidence: number;
  /** "typed" input is never merged by text: a user may type the same command twice on purpose. */
  source?: "stt" | "typed";
}

export interface ControlIntent extends Base {
  type: "ControlIntent";
  control: ControlKind;
  /** Reflex tier (0 = may run on a stable partial, 1 = prepare on partial, 2 = final only). */
  tier: 0 | 1 | 2;
  utteranceId?: string;
  taskId?: string;
}

export interface ConversationIntent extends Base {
  type: "ConversationIntent";
  intent: ConversationIntentKind;
  text: string;
  utteranceId?: string;
  taskId?: string;
}

export interface TaskCreated extends Base {
  type: "TaskCreated";
  taskId: string;
  goal: string;
  kind: string;
  steps?: { id: string; intent: string }[];
  parentId?: string;
  /** Put the new task on top of the focus stack (default true). */
  focus?: boolean;
}

export interface TaskAmended extends Base {
  type: "TaskAmended";
  taskId: string;
  change: string;
  steps?: { id: string; intent: string }[];
}

export interface TaskStatusChanged extends Base {
  type: "TaskStatusChanged";
  taskId: string;
  status: Exclude<TaskStatus, "cancelled">;
  reason?: string;
  /** Caused by the user's control (e.g. "wznów"): may leave a pause. */
  control?: boolean;
}

export interface TaskCancelled extends Base {
  type: "TaskCancelled";
  taskId: string;
  reason: string;
}

export interface TaskStepChanged extends Base {
  type: "TaskStepChanged";
  taskId: string;
  stepId: string;
  status: "pending" | "running" | Truth;
  evidence?: string;
}

export interface FocusChanged extends Base {
  type: "FocusChanged";
  /** Task to bring to the top of the focus stack; null pops the current one. */
  taskId: string | null;
}

export interface ObservationReceived extends Base {
  type: "ObservationReceived";
  env: string;
  /** navigation / dom_major bump the epoch and invalidate screen-bound referents in scope. */
  kind: "navigation" | "dom_major" | "dom_minor" | "scroll" | "focus" | "selection" | "window";
  scope?: string;
  page?: { id: string; url: string; title: string; scrollY?: number };
  window?: { id: string; app: string; title: string };
  detail?: Record<string, unknown>;
}

export interface ReferentAdded extends Base {
  type: "ReferentAdded";
  referent: Omit<Referent, "epoch" | "valid" | "createdAt"> & { epoch?: number; createdAt?: number };
  /** For collections: ordered item referent ids. */
  items?: string[];
  itemKind?: string;
}

export interface ReferentResolved extends Base {
  type: "ReferentResolved";
  referentId: string;
  utteranceId?: string;
  verb?: string;
}

export interface ReferentVerified extends Base {
  type: "ReferentVerified";
  referentId: string;
  evidence: string;
  metadata?: Record<string, unknown>;
}

export interface CollectionCursorMoved extends Base {
  type: "CollectionCursorMoved";
  collectionId: string;
  cursor: number;
  /** Item marked as rejected ("nie ten"). */
  rejected?: string;
}

/** A collection grew or was re-read; the cursor stays on the same item when it still exists. */
export interface CollectionUpdated extends Base {
  type: "CollectionUpdated";
  collectionId: string;
  items: string[];
}

export interface ActionStarted extends Base {
  type: "ActionStarted";
  actionId: string;
  taskId: string;
  stepId?: string;
  kind: string;
  argsHash: string;
  idempotencyKey?: string;
  external?: boolean;
}

export interface ActionAttempted extends Base {
  type: "ActionAttempted";
  actionId: string;
  evidence?: string;
}

export interface ActionVerified extends Base {
  type: "ActionVerified";
  actionId: string;
  evidence: string;
  undo?: UndoRecord;
}

export interface ActionFailed extends Base {
  type: "ActionFailed";
  actionId: string;
  reason: string;
  truth: Exclude<Truth, "CONFIRMED" | "ATTEMPTED">;
  /** The provider stated the effect did not happen (e.g. rejected before sending). */
  definite?: boolean;
}

export interface ClipboardChanged extends Base {
  type: "ClipboardChanged";
  hash: string;
  preview: string;
  byJarvis: boolean;
  provenance: Provenance;
}

export interface WindowFocused extends Base {
  type: "WindowFocused";
  windowId: string;
  app: string;
  title: string;
}

export interface ConsentRequested extends Base {
  type: "ConsentRequested";
  consentId: string;
  taskId: string;
  actionId?: string;
  summary: string;
  args: Record<string, string>;
}

export interface ConsentGranted extends Base {
  type: "ConsentGranted";
  consentId: string;
}

export interface ConsentDenied extends Base {
  type: "ConsentDenied";
  consentId: string;
}

export interface CapabilitiesUpdated extends Base {
  type: "CapabilitiesUpdated";
  capabilities: CapabilityState[];
}

export type KernelEvent =
  | SpeechPartial | SpeechFinal | ControlIntent | ConversationIntent
  | TaskCreated | TaskAmended | TaskStatusChanged | TaskCancelled | TaskStepChanged | FocusChanged
  | ObservationReceived | ReferentAdded | ReferentResolved | ReferentVerified | CollectionCursorMoved | CollectionUpdated
  | ActionStarted | ActionAttempted | ActionVerified | ActionFailed
  | ClipboardChanged | WindowFocused
  | ConsentRequested | ConsentGranted | ConsentDenied
  | CapabilitiesUpdated;

export type KernelEventType = KernelEvent["type"];

/** Distributive Omit so each union member keeps its own fields. */
export type EventInput<E extends KernelEvent = KernelEvent> = E extends KernelEvent
  ? Omit<E, "id" | "at"> & { id?: string; at?: number }
  : never;

/**
 * Events persisted in the task journal. High-frequency and screen-bound events
 * (speech partials, observations, referents) never reach durable storage.
 */
export const DURABLE_EVENTS: ReadonlySet<KernelEventType> = new Set<KernelEventType>([
  "TaskCreated", "TaskAmended", "TaskStatusChanged", "TaskCancelled", "TaskStepChanged", "FocusChanged",
  "ActionStarted", "ActionAttempted", "ActionVerified", "ActionFailed",
  "ConsentRequested", "ConsentGranted", "ConsentDenied",
]);

export const isDurable = (e: KernelEvent): boolean => DURABLE_EVENTS.has(e.type);

/**
 * Frequent screen and speech events: their ids are not kept for dedup, so a stream of them
 * cannot push the ids of commands and actions out of the bounded "seen" set.
 */
export const HIGH_FREQUENCY_EVENTS: ReadonlySet<KernelEventType> = new Set<KernelEventType>([
  "SpeechPartial", "ObservationReceived", "CollectionUpdated", "CapabilitiesUpdated", "WindowFocused",
]);
