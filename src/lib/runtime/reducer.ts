// Pure kernel reducer: (state, event) -> state. No I/O, no timers, no randomness.

import type { KernelEvent } from "./events";
import { addReferent, emptyRegistry, invalidateScope, moveCursor, patchReferent } from "./referents";
import type {
  ActionRecord, CapabilityState, ClipboardState, ConsentRecord, PageState, Referent, ReferentRegistry,
  TaskState, TaskStatus, WindowState,
} from "./types";
import { TERMINAL_TASK } from "./types";

export const MAX_ACTIONS = 300;
export const MAX_TASKS = 100;

export interface KernelState {
  seq: number;
  observationEpoch: number;
  tasks: Record<string, TaskState>;
  taskOrder: string[];
  /** Task ids, top of stack last. */
  focusStack: string[];
  actions: Record<string, ActionRecord>;
  actionOrder: string[];
  /** idempotencyKey -> actionId of the action that owns it. */
  idempotency: Record<string, string>;
  referents: ReferentRegistry;
  page?: PageState;
  window?: WindowState;
  clipboard?: ClipboardState;
  consents: Record<string, ConsentRecord>;
  capabilities: Record<string, CapabilityState>;
  lastVerifiedActionId?: string;
  lastPartial?: { utteranceId: string; text: string; at: number };
  lastFinal?: { utteranceId: string; text: string; at: number };
  lastIntent?: { intent: string; text: string; at: number; taskId?: string };
}

export const initialState = (): KernelState => ({
  seq: 0,
  observationEpoch: 0,
  tasks: {},
  taskOrder: [],
  focusStack: [],
  actions: {},
  actionOrder: [],
  idempotency: {},
  referents: emptyRegistry(),
  consents: {},
  capabilities: {},
});

export const CLIPBOARD_REFERENT_ID = "clipboard";

/** Top of the focus stack (the task the user is talking about). */
export const focusedTaskId = (s: KernelState): string | undefined => s.focusStack[s.focusStack.length - 1];

const withoutFocus = (stack: string[], id: string) => stack.filter((x) => x !== id);

function setTask(s: KernelState, id: string, patch: Partial<TaskState>, at: number): KernelState {
  const t = s.tasks[id];
  if (!t) return s;
  return { ...s, tasks: { ...s.tasks, [id]: { ...t, ...patch, updatedAt: at } } };
}

function setStatus(s: KernelState, id: string, status: TaskStatus, at: number, reason?: string): KernelState {
  const t = s.tasks[id];
  if (!t || TERMINAL_TASK.has(t.status) || t.status === status) return s;
  let next = setTask(s, id, { status, statusReason: reason }, at);
  if (TERMINAL_TASK.has(status)) next = { ...next, focusStack: withoutFocus(next.focusStack, id) };
  return next;
}

/** Most recently created task in one of the given states. */
function latestTaskIn(s: KernelState, statuses: TaskStatus[]): string | undefined {
  for (let i = s.taskOrder.length - 1; i >= 0; i--) {
    const t = s.tasks[s.taskOrder[i]];
    if (t && statuses.includes(t.status)) return t.id;
  }
  return undefined;
}

const LIVE: TaskStatus[] = ["running", "paused", "waiting_consent", "blocked"];

function controlTarget(s: KernelState, explicit?: string): string | undefined {
  if (explicit && s.tasks[explicit]) return explicit;
  const f = focusedTaskId(s);
  if (f && LIVE.includes(s.tasks[f]?.status)) return f;
  return latestTaskIn(s, LIVE);
}

function applyControl(s: KernelState, control: string, at: number, taskId?: string): KernelState {
  const target = controlTarget(s, taskId);
  if (!target) return s;
  const status = s.tasks[target].status;
  switch (control) {
    case "stop":
    case "cancel":
    case "CANCEL":
      return setStatus(s, target, "cancelled", at, `control:${control.toLowerCase()}`);
    case "pause":
    case "PAUSE":
      return status === "running" || status === "waiting_consent" ? setStatus(s, target, "paused", at, "control:pause") : s;
    case "resume":
    case "RESUME": {
      const paused = s.tasks[target].status === "paused" ? target : latestTaskIn(s, ["paused"]);
      if (!paused) return s;
      const next = setStatus(s, paused, "running", at, "control:resume");
      return { ...next, focusStack: [...withoutFocus(next.focusStack, paused), paused] };
    }
    default:
      return s;
  }
}

function capActions(s: KernelState): KernelState {
  if (s.actionOrder.length <= MAX_ACTIONS) return s;
  const drop = s.actionOrder.slice(0, s.actionOrder.length - MAX_ACTIONS);
  const actions = { ...s.actions };
  for (const id of drop) delete actions[id];
  return { ...s, actions, actionOrder: s.actionOrder.slice(drop.length) };
}

function capTasks(s: KernelState): KernelState {
  if (s.taskOrder.length <= MAX_TASKS) return s;
  const removable = s.taskOrder.filter((id) => TERMINAL_TASK.has(s.tasks[id]?.status));
  const drop = new Set(removable.slice(0, s.taskOrder.length - MAX_TASKS));
  if (!drop.size) return s;
  const tasks = { ...s.tasks };
  for (const id of drop) delete tasks[id];
  return { ...s, tasks, taskOrder: s.taskOrder.filter((id) => !drop.has(id)) };
}

export function reduce(prev: KernelState, e: KernelEvent): KernelState {
  const s: KernelState = { ...prev, seq: prev.seq + 1 };
  switch (e.type) {
    case "SpeechPartial":
      return { ...s, lastPartial: { utteranceId: e.utteranceId, text: e.text, at: e.at } };
    case "SpeechFinal":
      return { ...s, lastFinal: { utteranceId: e.utteranceId, text: e.text, at: e.at } };
    case "ControlIntent":
      return applyControl(s, e.control, e.at, e.taskId);
    case "ConversationIntent": {
      const next = { ...s, lastIntent: { intent: e.intent, text: e.text, at: e.at, taskId: e.taskId } };
      return e.intent === "PAUSE" || e.intent === "RESUME" || e.intent === "CANCEL" ? applyControl(next, e.intent, e.at, e.taskId) : next;
    }
    case "TaskCreated": {
      if (s.tasks[e.taskId]) return s;
      const task: TaskState = {
        id: e.taskId, goal: e.goal, kind: e.kind, status: "running", createdAt: e.at, updatedAt: e.at,
        parentId: e.parentId, steps: (e.steps || []).map((x) => ({ ...x, status: "pending" as const })),
        referents: [], idempotencyKeys: [], undo: [],
      };
      const focusStack = e.focus === false ? s.focusStack : [...withoutFocus(s.focusStack, e.taskId), e.taskId];
      return capTasks({ ...s, tasks: { ...s.tasks, [e.taskId]: task }, taskOrder: [...s.taskOrder, e.taskId], focusStack });
    }
    case "TaskAmended": {
      const t = s.tasks[e.taskId];
      if (!t || TERMINAL_TASK.has(t.status)) return s;
      const steps = e.steps
        ? e.steps.map((x) => t.steps.find((o) => o.id === x.id) ?? { ...x, status: "pending" as const })
        : t.steps;
      return setTask(s, e.taskId, { steps, statusReason: `amended: ${e.change}` }, e.at);
    }
    case "TaskStatusChanged":
      return setStatus(s, e.taskId, e.status, e.at, e.reason);
    case "TaskCancelled":
      return setStatus(s, e.taskId, "cancelled", e.at, e.reason);
    case "TaskStepChanged": {
      const t = s.tasks[e.taskId];
      if (!t) return s;
      const exists = t.steps.some((x) => x.id === e.stepId);
      const steps = exists
        ? t.steps.map((x) => (x.id === e.stepId ? { ...x, status: e.status, evidence: e.evidence ?? x.evidence } : x))
        : [...t.steps, { id: e.stepId, intent: e.stepId, status: e.status, evidence: e.evidence }];
      return setTask(s, e.taskId, { steps, currentStepId: e.stepId }, e.at);
    }
    case "FocusChanged": {
      if (e.taskId === null) return { ...s, focusStack: s.focusStack.slice(0, -1) };
      const t = s.tasks[e.taskId];
      if (!t || TERMINAL_TASK.has(t.status)) return s;
      return { ...s, focusStack: [...withoutFocus(s.focusStack, e.taskId), e.taskId] };
    }
    case "ObservationReceived": {
      const major = e.kind === "navigation" || e.kind === "dom_major";
      const epoch = major || e.kind === "window" ? s.observationEpoch + 1 : s.observationEpoch;
      let next: KernelState = { ...s, observationEpoch: epoch };
      if (major) next = { ...next, referents: invalidateScope(next.referents, e.scope, e.kind) };
      if (e.page) next = { ...next, page: { ...e.page, epoch } };
      if (e.window) next = { ...next, window: { ...e.window } };
      return next;
    }
    case "ReferentAdded": {
      const r: Referent = {
        ...e.referent,
        epoch: e.referent.epoch ?? s.observationEpoch,
        createdAt: e.referent.createdAt ?? e.at,
        valid: true,
      };
      const coll = r.type === "Collection" ? { items: e.items || [], itemKind: e.itemKind || "item" } : undefined;
      return { ...s, referents: addReferent(s.referents, r, coll) };
    }
    case "ReferentResolved": {
      const r = s.referents.byId[e.referentId];
      if (!r) return s;
      return { ...s, referents: patchReferent(s.referents, e.referentId, { lastMentioned: e.at, salience: Math.min(1, r.salience + 0.1) }, true) };
    }
    case "ReferentVerified": {
      const r = s.referents.byId[e.referentId];
      if (!r || !r.valid) return s;
      return {
        ...s,
        referents: patchReferent(s.referents, e.referentId, { evidence: e.evidence, epoch: s.observationEpoch, lastActed: e.at, metadata: e.metadata }, true),
      };
    }
    case "CollectionCursorMoved": {
      const c = s.referents.collections[e.collectionId];
      if (!c || e.cursor < -1 || e.cursor >= c.items.length) return s;
      let reg = moveCursor(s.referents, e.collectionId, e.cursor, e.rejected);
      const item = c.items[e.cursor];
      if (item) reg = patchReferent(reg, item, { lastMentioned: e.at }, true);
      reg = patchReferent(reg, e.collectionId, { lastMentioned: e.at }, false);
      return { ...s, referents: reg };
    }
    case "ActionStarted": {
      if (s.actions[e.actionId]) return s;
      const rec: ActionRecord = {
        id: e.actionId, taskId: e.taskId, stepId: e.stepId, kind: e.kind, argsHash: e.argsHash,
        idempotencyKey: e.idempotencyKey, status: "started", startedAt: e.at, external: !!e.external,
      };
      let next: KernelState = {
        ...s,
        actions: { ...s.actions, [e.actionId]: rec },
        actionOrder: [...s.actionOrder, e.actionId],
        idempotency: e.idempotencyKey ? { ...s.idempotency, [e.idempotencyKey]: e.actionId } : s.idempotency,
      };
      const t = next.tasks[e.taskId];
      if (t && e.idempotencyKey && !t.idempotencyKeys.includes(e.idempotencyKey)) {
        next = setTask(next, e.taskId, { idempotencyKeys: [...t.idempotencyKeys, e.idempotencyKey] }, e.at);
      }
      return capActions(next);
    }
    case "ActionAttempted": {
      const a = s.actions[e.actionId];
      if (!a || a.status !== "started") return s;
      return { ...s, actions: { ...s.actions, [e.actionId]: { ...a, status: "ATTEMPTED", evidence: e.evidence } } };
    }
    case "ActionVerified": {
      const a = s.actions[e.actionId];
      if (!a || (a.status !== "started" && a.status !== "ATTEMPTED" && a.status !== "UNKNOWN_AFTER_ATTEMPT")) return s;
      // CONFIRMED requires read-back evidence; without it the action stays ATTEMPTED.
      if (!e.evidence || !e.evidence.trim()) {
        return { ...s, actions: { ...s.actions, [e.actionId]: { ...a, status: "ATTEMPTED", reason: "verification without evidence" } } };
      }
      let next: KernelState = {
        ...s,
        actions: { ...s.actions, [e.actionId]: { ...a, status: "CONFIRMED", evidence: e.evidence, endedAt: e.at } },
        lastVerifiedActionId: e.actionId,
      };
      const t = next.tasks[a.taskId];
      if (t && e.undo) next = setTask(next, a.taskId, { undo: [...t.undo, e.undo].slice(-20) }, e.at);
      return next;
    }
    case "ActionFailed": {
      const a = s.actions[e.actionId];
      if (!a || a.status === "CONFIRMED") return s;
      // An external action that may already have happened never degrades to a clean FAILED.
      const truth = a.external && (a.status === "ATTEMPTED" || a.status === "UNKNOWN_AFTER_ATTEMPT") && e.truth === "FAILED"
        ? "UNKNOWN_AFTER_ATTEMPT"
        : e.truth;
      let next: KernelState = { ...s, actions: { ...s.actions, [e.actionId]: { ...a, status: truth, reason: e.reason, endedAt: e.at } } };
      // A failed (not merely unknown) action releases its idempotency key so a retry is possible.
      if (truth !== "UNKNOWN_AFTER_ATTEMPT" && a.idempotencyKey && next.idempotency[a.idempotencyKey] === a.id) {
        const idempotency = { ...next.idempotency };
        delete idempotency[a.idempotencyKey];
        next = { ...next, idempotency };
      }
      return next;
    }
    case "ClipboardChanged": {
      const clipboard: ClipboardState = {
        hash: e.hash, preview: e.preview, byJarvis: e.byJarvis, at: e.at, provenance: e.provenance,
        jarvisHash: e.byJarvis ? e.hash : s.clipboard?.jarvisHash,
      };
      const existing = s.referents.byId[CLIPBOARD_REFERENT_ID];
      const ref: Referent = {
        id: CLIPBOARD_REFERENT_ID, type: "Clipboard", source: e.byJarvis ? "jarvis" : "system", epoch: s.observationEpoch,
        semanticKey: `clipboard:${e.hash}`, confidence: 1, salience: 0.6, createdAt: e.at,
        lastActed: e.byJarvis ? e.at : existing?.lastActed, metadata: { hash: e.hash, preview: e.preview, byJarvis: e.byJarvis },
        provenance: e.provenance, valid: true,
      };
      return { ...s, clipboard, referents: addReferent(s.referents, ref) };
    }
    case "WindowFocused":
      return { ...s, observationEpoch: s.observationEpoch + 1, window: { id: e.windowId, app: e.app, title: e.title } };
    case "ConsentRequested": {
      if (s.consents[e.consentId]) return s;
      const rec: ConsentRecord = {
        id: e.consentId, taskId: e.taskId, actionId: e.actionId, summary: e.summary, args: { ...e.args },
        status: "pending", requestedAt: e.at,
      };
      const next = { ...s, consents: { ...s.consents, [e.consentId]: rec } };
      return setStatus(next, e.taskId, "waiting_consent", e.at, "consent requested");
    }
    case "ConsentGranted":
    case "ConsentDenied": {
      const c = s.consents[e.consentId];
      if (!c || c.status !== "pending") return s;
      const granted = e.type === "ConsentGranted";
      const next = { ...s, consents: { ...s.consents, [e.consentId]: { ...c, status: granted ? "granted" as const : "denied" as const, decidedAt: e.at } } };
      const t = next.tasks[c.taskId];
      if (!t || t.status !== "waiting_consent") return next;
      return setStatus(next, c.taskId, granted ? "running" : "blocked", e.at, granted ? "consent granted" : "consent denied");
    }
    case "CapabilitiesUpdated": {
      const capabilities = { ...s.capabilities };
      for (const c of e.capabilities) capabilities[c.id] = c;
      return { ...s, capabilities };
    }
    default:
      return prev;
  }
}
