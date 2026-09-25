// "What am I doing" view and the diagnostics export (mission M10). Both are pure functions of the
// kernel state, so the panel shows what the runtime actually knows (task, step, target, where,
// how it was verified) and never what a model said it did. The export is for bug reports: every
// string is redacted (mail addresses, phone numbers, keys, tokens) and clipped, clipboard and
// consent contents and quoted screen text are reduced to their length, and nothing is sent
// anywhere by this module.

import { redactSecret } from "../cognitiveStatus";
import type { KernelState } from "./reducer";
import { focusedTaskId } from "./reducer";
import type { RuntimeTurn } from "./lanes/runtime";
import type { Skill } from "./skills";
import { TERMINAL_TASK, type ActionRecord, type CapabilityState, type TaskState, type TaskStatus } from "./types";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// No lookbehind (older WebViews): the leading boundary is captured and put back.
const PHONE = /(^|[^\w.])(\+?\d[\d \-()]{7,}\d)(?![\w.])/g;
const SECRET_ASSIGN = /\b(password|passwd|haslo|hasło|token|secret|api[_-]?key|authorization|cookie)\b\s*[:=]\s*\S+/gi;
const URL_SECRETS = /([?&](?:key|token|access_token|auth|sig|signature|code)=)[^&#\s]+/gi;

/** Mask personal and secret data in one string and clip it. */
export function redact(text: unknown, max = 200): string {
  const s = typeof text === "string" ? text : text === undefined || text === null ? "" : String(text);
  const masked = redactSecret(s)
    .replace(SECRET_ASSIGN, (_m, k: string) => `${k}=[ukryte]`)
    .replace(URL_SECRETS, "$1[ukryte]")
    .replace(EMAIL, (m) => `${m[0]}***@${m.split("@")[1].replace(/^[^.]+/, "***")}`)
    .replace(PHONE, "$1[telefon]");
  return masked.length > max ? `${masked.slice(0, max - 1)}…` : masked;
}

const OPEN_QUOTES = new Set(['"', "„", "«", "'", "“"]);
const CLOSE_QUOTES = new Set(['"', "”", "»", "'", "“"]);

/**
 * For exports: quoted screen text (selection, clipboard, mail body in evidence) becomes its
 * length. Everything from the first opening quote to the last closing quote goes, so quotes
 * inside the quoted text cannot let part of it through.
 */
export function maskQuoted(text: string): string {
  const chars = [...text];
  const first = chars.findIndex((c) => OPEN_QUOTES.has(c));
  if (first < 0) return text;
  let last = -1;
  for (let i = chars.length - 1; i > first; i--) if (CLOSE_QUOTES.has(chars[i])) { last = i; break; }
  if (last < 0) return `${chars.slice(0, first).join("")}[${chars.length - first - 1} zn.]`;
  return `${chars.slice(0, first).join("")}[${last - first - 1} zn.]${maskQuoted(chars.slice(last + 1).join(""))}`;
}

const forExport = (text: unknown, max = 160) => maskQuoted(redact(text, max * 4)).slice(0, max);

// ---------------------------------------------------------------- "co robię" panel

export interface StatusAction {
  kind: string;
  truth: string;
  evidence?: string;
  at: number;
}

export interface StatusView {
  state: "idle" | TaskStatus;
  goal?: string;
  step?: string;
  stepIndex?: number;
  stepCount?: number;
  /** What the current step acts on (the focused referent), as the runtime knows it. */
  target?: string;
  /** Where: the environment and the page or window. */
  environment: string;
  place?: string;
  model?: string;
  elapsedMs?: number;
  /** How the last action of this task was checked (the read-back evidence). */
  verification?: string;
  pendingConsent?: string;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  recent: StatusAction[];
}

function currentTask(s: KernelState): TaskState | undefined {
  const fid = focusedTaskId(s);
  const focused = fid ? s.tasks[fid] : undefined;
  if (focused && !TERMINAL_TASK.has(focused.status)) return focused;
  for (let i = s.taskOrder.length - 1; i >= 0; i--) {
    const t = s.tasks[s.taskOrder[i]];
    if (t && !TERMINAL_TASK.has(t.status)) return t;
  }
  return undefined;
}

const actionsOf = (s: KernelState, pred: (a: ActionRecord) => boolean, n: number): ActionRecord[] =>
  s.actionOrder.map((id) => s.actions[id]).filter((a) => a && pred(a)).slice(-n);

export function statusView(s: KernelState, o: { now: number; environment: string; model?: string; recent?: number }): StatusView {
  const task = currentTask(s);
  const page = s.page && s.page.id !== "closed" ? `${redact(s.page.title, 60)} (${redact(hostOf(s.page.url), 60)})` : undefined;
  const win = s.window ? `${redact(s.window.app, 40)}: ${redact(s.window.title, 60)}` : undefined;
  const recent = actionsOf(s, () => true, o.recent ?? 5).reverse().map((a) => ({ kind: a.kind, truth: a.status, evidence: a.evidence ? redact(a.evidence, 120) : undefined, at: a.endedAt ?? a.startedAt }));
  const base: StatusView = { state: "idle", environment: o.environment, place: page ?? win, model: o.model, canPause: false, canResume: false, canStop: false, recent };
  if (!task) return base;
  const idx = task.steps.findIndex((x) => x.id === task.currentStepId);
  const step = idx >= 0 ? task.steps[idx] : task.steps[task.steps.length - 1];
  const last = actionsOf(s, (a) => a.taskId === task.id, 1)[0];
  const focus = [...task.referents].reverse().map((id) => s.referents.byId[id]).find((r) => r && r.valid);
  const consent = Object.values(s.consents).find((c) => c.taskId === task.id && c.status === "pending");
  return {
    ...base,
    state: task.status,
    goal: redact(task.goal, 120),
    step: step ? redact(step.intent, 120) : undefined,
    stepIndex: idx >= 0 ? idx + 1 : undefined,
    stepCount: task.steps.length || undefined,
    target: focus ? `${focus.type}: ${redact(String(focus.metadata.text ?? focus.metadata.title ?? focus.semanticKey), 80)}` : undefined,
    elapsedMs: Math.max(0, o.now - task.createdAt),
    verification: last ? `${last.kind}: ${last.status}${last.evidence ? `, ${redact(last.evidence, 120)}` : ""}` : undefined,
    pendingConsent: consent ? redact(consent.summary, 160) : undefined,
    canPause: task.status === "running" || task.status === "waiting_consent",
    canResume: task.status === "paused",
    canStop: true,
  };
}

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1] : url;
}

// ---------------------------------------------------------------- export

export interface DiagnosticsInput {
  state: KernelState;
  turns?: RuntimeTurn[];
  capabilities?: CapabilityState[];
  latency?: Record<string, { count: number; p50: number; p95: number }>;
  skills?: Skill[];
  environment: string;
  appVersion?: string;
  now: number;
}

export interface Diagnostics {
  format: "jarvis-diagnostics/1";
  createdAt: string;
  appVersion?: string;
  environment: string;
  tasks: { id: string; kind: string; goal: string; status: string; reason?: string; steps: { intent: string; status: string; evidence?: string }[]; error?: string }[];
  actions: { id: string; taskId: string; kind: string; status: string; external: boolean; ms?: number; evidence?: string; reason?: string }[];
  consents: { id: string; status: string; summaryChars: number }[];
  clipboard?: { previewChars: number; byJarvis: boolean; provenance: string };
  page?: { host: string; epoch: number };
  capabilities: { id: string; status: string; provider?: string; detail?: string }[];
  latency?: Record<string, { count: number; p50: number; p95: number }>;
  turns: { route: string; text: string; truth?: string; sayChars?: number; at: number }[];
  skills: { name: string; steps: number; external: boolean; runs: number; invalidated?: string }[];
}

/** Redacted, bounded diagnostics. Nothing here is sent anywhere; the user decides what to share. */
export function exportDiagnostics(i: DiagnosticsInput): Diagnostics {
  const s = i.state;
  const tasks = s.taskOrder.slice(-30).map((id) => s.tasks[id]).filter(Boolean).map((t) => ({
    id: t.id, kind: t.kind, goal: forExport(t.goal, 120), status: t.status, reason: t.statusReason ? forExport(t.statusReason, 120) : undefined,
    steps: t.steps.map((x) => ({ intent: forExport(x.intent, 80), status: x.status, evidence: x.evidence ? forExport(x.evidence, 120) : undefined })),
    error: t.lastError ? forExport(t.lastError, 160) : undefined,
  }));
  const actions = s.actionOrder.slice(-100).map((id) => s.actions[id]).filter(Boolean).map((a) => ({
    id: a.id, taskId: a.taskId, kind: a.kind, status: a.status, external: a.external,
    ms: a.endedAt !== undefined ? a.endedAt - a.startedAt : undefined,
    evidence: a.evidence ? forExport(a.evidence) : undefined, reason: a.reason ? forExport(a.reason) : undefined,
  }));
  const caps = i.capabilities ?? Object.values(s.capabilities);
  return {
    format: "jarvis-diagnostics/1",
    createdAt: new Date(i.now).toISOString(),
    appVersion: i.appVersion,
    environment: i.environment,
    tasks,
    actions,
    consents: Object.values(s.consents).map((c) => ({ id: c.id, status: c.status, summaryChars: c.summary.length })),
    clipboard: s.clipboard ? { previewChars: s.clipboard.preview.length, byJarvis: s.clipboard.byJarvis, provenance: s.clipboard.provenance } : undefined,
    page: s.page ? { host: redact(hostOf(s.page.url), 80), epoch: s.page.epoch } : undefined,
    capabilities: caps.map((c) => ({ id: c.id, status: c.status, provider: c.provider, detail: c.detail ? forExport(c.detail, 120) : undefined })),
    latency: i.latency,
    // What JARVIS said quotes the screen (titles, comments): only its length leaves the machine.
    turns: (i.turns ?? []).slice(-40).map((t) => ({ route: t.route, text: forExport(t.text, 120), truth: t.result?.truth, sayChars: t.say ? [...t.say].length : undefined, at: t.at })),
    skills: (i.skills ?? []).map((k) => ({ name: forExport(k.name, 60), steps: k.steps.length, external: k.external, runs: k.runs, invalidated: k.invalidated ? forExport(k.invalidated.reason, 120) : undefined })),
  };
}
