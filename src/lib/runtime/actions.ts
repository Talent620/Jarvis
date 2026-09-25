// Action engine (mission 5.2 ACTION lane, 5.8, 5.9): one micro-action with a declared end
// condition. Capability check -> ActionStarted (idempotency) -> act -> read-back ->
// postcondition via truth ladder -> ActionVerified or ActionFailed. At most two attempts for
// local actions, never an automatic retry for an external effect.

import { checkAction } from "./capabilities";
import type { ActResult, ComputerEnvironment, EnvAction, ReadResult } from "./env/types";
import type { Kernel } from "./kernel";
import { needsBefore, readQueryFor, verify } from "./postconditions";
import { isPrecondition, type Truth } from "./truth";
import { hashArgs } from "./util";

export interface ActionContext {
  kernel: Kernel;
  env: ComputerEnvironment;
  now?: () => number;
}

export interface PerformSpec {
  taskId: string;
  stepId?: string;
  action: EnvAction;
  idempotencyKey?: string;
  /** External side effect (mail, SMS): never retried automatically. */
  external?: boolean;
  maxAttempts?: number;
  signal?: AbortSignal;
}

export interface PerformResult {
  actionId?: string;
  truth: Truth;
  evidence: string;
  reason?: string;
  result?: ActResult;
  after?: ReadResult;
  attempts: number;
}

/** A second attempt would repeat the effect (scroll twice, open another item), not retry it. */
const NOT_REPEATABLE = new Set<EnvAction["kind"]>(["browser.open", "browser.scroll", "desktop.type", "desktop.keys"]);

type FailTruth ="SIMULATED" | "UNKNOWN_AFTER_ATTEMPT" | "FAILED" | "BLOCKED" | "NEEDS_PERMISSION" | "NEEDS_HARDWARE" | "NEEDS_CAPABILITY";

export async function performAction(ctx: ActionContext, spec: PerformSpec): Promise<PerformResult> {
  const { kernel, env } = ctx;
  const now = ctx.now ?? (() => Date.now());
  const kind = spec.action.kind;
  const step = (status: "running" | Truth, evidence?: string) => {
    if (spec.stepId) kernel.dispatch({ type: "TaskStepChanged", taskId: spec.taskId, stepId: spec.stepId, status, evidence });
  };

  const cap = checkAction(kernel.state.capabilities, kind);
  if (!cap.ok) {
    const reason = `missing capability: ${cap.missing.map((m) => m.group.join(" | ")).join("; ")}`;
    step(cap.truth, reason);
    return { truth: cap.truth, evidence: "", reason, attempts: 0 };
  }

  const actionId = kernel.id("act");
  const started = kernel.dispatch({
    type: "ActionStarted", actionId, taskId: spec.taskId, stepId: spec.stepId, kind,
    argsHash: hashArgs(spec.action), idempotencyKey: spec.idempotencyKey, external: !!spec.external,
  });
  if (!started.accepted) {
    const existing = started.existingActionId ? kernel.state.actions[started.existingActionId] : undefined;
    const truth: Truth = existing && existing.status !== "started" ? existing.status : "UNKNOWN_AFTER_ATTEMPT";
    return { actionId: started.existingActionId, truth, evidence: existing?.evidence ?? "", reason: `duplicate (${started.reason})`, attempts: 0 };
  }
  step("running");

  const signal = spec.signal ?? kernel.signal(spec.taskId);
  const query = readQueryFor(spec.action);
  const maxAttempts = spec.external || NOT_REPEATABLE.has(kind) ? 1 : Math.max(1, spec.maxAttempts ?? 2);
  const gate = async () => {
    // Pause gate: a paused task waits here before the next micro-action; stop rejects it.
    if (kernel.state.tasks[spec.taskId]) {
      try { await kernel.waitRunnable(spec.taskId); } catch { /* cancelled or finished: handled by the caller */ }
    }
  };
  const fail = (truth: FailTruth, reason: string, attempts: number, extra: Partial<PerformResult> = {}): PerformResult => {
    kernel.dispatch({ type: "ActionFailed", actionId, reason, truth });
    const final = kernel.state.actions[actionId]?.status;
    const t: Truth = final && final !== "started" ? final : truth;
    step(t, reason);
    return { actionId, truth: t, evidence: "", reason, attempts, ...extra };
  };

  let before: ReadResult | undefined;
  if (needsBefore(spec.action)) {
    // A paused task must not take its "before" snapshot now and act on it much later.
    await gate();
    if (signal.aborted) return fail("FAILED", "cancelled", 0);
    try {
      before = await env.read(query);
    } catch (e) {
      return fail("FAILED", `read-back before action failed: ${e instanceof Error ? e.message : e}`, 0);
    }
  }

  let lastReason = "not verified";
  let lastTruth: Truth = "FAILED";
  let result: ActResult | undefined;
  let after: ReadResult | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await gate();
    if (signal.aborted) return fail(spec.external && attempt > 1 ? "UNKNOWN_AFTER_ATTEMPT" : "FAILED", "cancelled", attempt - 1);
    // An external effect is recorded as attempted before it can happen: a crash inside act()
    // then restores as UNKNOWN_AFTER_ATTEMPT, never as a clean failure.
    if (spec.external) kernel.dispatch({ type: "ActionAttempted", actionId, evidence: `attempt ${attempt} dispatched` });
    try {
      result = await env.act(spec.action, signal);
    } catch (e) {
      result = { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
    if (result.status === "failed" && result.error === "aborted") {
      return fail(spec.external ? "UNKNOWN_AFTER_ATTEMPT" : "FAILED", "cancelled", attempt, { result });
    }
    if (spec.external && result.status === "failed") {
      // The environment could not say whether the effect happened.
      return fail("UNKNOWN_AFTER_ATTEMPT", result.error ?? "failed after dispatch", attempt, { result });
    }
    if (!spec.external && result.status === "done") kernel.dispatch({ type: "ActionAttempted", actionId, evidence: `attempt ${attempt}` });
    try {
      after = await env.read(query);
    } catch (e) {
      lastTruth = spec.external ? "UNKNOWN_AFTER_ATTEMPT" : "FAILED";
      lastReason = `read-back failed: ${e instanceof Error ? e.message : e}`;
      continue;
    }
    const v = verify(spec.action, before, after, result, now());
    if (v.truth === "CONFIRMED") {
      // Undo data is bound to the page it was recorded on: after navigation it no longer applies.
      kernel.dispatch({
        type: "ActionVerified", actionId, evidence: v.evidence,
        undo: result.undo ? { actionId, kind, data: { ...result.undo, pageId: kernel.state.page?.id } } : undefined,
      });
      step("CONFIRMED", v.evidence);
      return { actionId, truth: "CONFIRMED", evidence: v.evidence, result, after, attempts: attempt };
    }
    lastTruth = v.truth;
    lastReason = v.reason ?? result.error ?? "read-back mismatch";
    if (v.unverifiable && !spec.external) {
      // Done, and nothing can prove or disprove it: ATTEMPTED is the honest end state.
      step("ATTEMPTED", lastReason);
      return { actionId, truth: "ATTEMPTED", evidence: "", reason: lastReason, result, after, attempts: attempt };
    }
    if (isPrecondition(v.truth)) break;
  }
  // Local action not confirmed after the attempts: FAILED. An external one may have happened.
  const truth: FailTruth = isPrecondition(lastTruth)
    ? (lastTruth as FailTruth)
    : spec.external && result?.status === "done" ? "UNKNOWN_AFTER_ATTEMPT" : lastTruth === "SIMULATED" ? "SIMULATED" : "FAILED";
  return fail(truth, lastReason, maxAttempts, { result, after });
}
