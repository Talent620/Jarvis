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

type FailTruth = "SIMULATED" | "UNKNOWN_AFTER_ATTEMPT" | "FAILED" | "BLOCKED" | "NEEDS_PERMISSION" | "NEEDS_HARDWARE" | "NEEDS_CAPABILITY";

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
  const maxAttempts = spec.external ? 1 : Math.max(1, spec.maxAttempts ?? 2);
  const fail = (truth: FailTruth, reason: string, attempts: number, extra: Partial<PerformResult> = {}): PerformResult => {
    kernel.dispatch({ type: "ActionFailed", actionId, reason, truth });
    const final = kernel.state.actions[actionId]?.status;
    const t: Truth = final && final !== "started" ? final : truth;
    step(t, reason);
    return { actionId, truth: t, evidence: "", reason, attempts, ...extra };
  };

  let before: ReadResult | undefined;
  try {
    before = needsBefore(spec.action) ? await env.read(query) : undefined;
  } catch (e) {
    return fail("FAILED", `read-back before action failed: ${e instanceof Error ? e.message : e}`, 0);
  }

  let lastReason = "not verified";
  let lastTruth: Truth = "FAILED";
  let result: ActResult | undefined;
  let after: ReadResult | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) return fail(spec.external && attempt > 1 ? "UNKNOWN_AFTER_ATTEMPT" : "FAILED", "cancelled", attempt - 1);
    result = await env.act(spec.action, signal);
    if (result.status === "failed" && result.error === "aborted") {
      return fail(spec.external ? "UNKNOWN_AFTER_ATTEMPT" : "FAILED", "cancelled", attempt, { result });
    }
    if (result.status === "done") kernel.dispatch({ type: "ActionAttempted", actionId, evidence: `attempt ${attempt}` });
    try {
      after = await env.read(query);
    } catch (e) {
      lastTruth = spec.external ? "UNKNOWN_AFTER_ATTEMPT" : "FAILED";
      lastReason = `read-back failed: ${e instanceof Error ? e.message : e}`;
      continue;
    }
    const v = verify(spec.action, before, after, result, now());
    if (v.truth === "CONFIRMED") {
      kernel.dispatch({
        type: "ActionVerified", actionId, evidence: v.evidence,
        undo: result.undo ? { actionId, kind, data: result.undo } : undefined,
      });
      step("CONFIRMED", v.evidence);
      return { actionId, truth: "CONFIRMED", evidence: v.evidence, result, after, attempts: attempt };
    }
    lastTruth = v.truth;
    lastReason = v.reason ?? result.error ?? "read-back mismatch";
    if (isPrecondition(v.truth)) break;
  }
  // Local action not confirmed after the attempts: FAILED. An external one may have happened.
  const truth: FailTruth = isPrecondition(lastTruth)
    ? (lastTruth as FailTruth)
    : spec.external && result?.status === "done" ? "UNKNOWN_AFTER_ATTEMPT" : lastTruth === "SIMULATED" ? "SIMULATED" : "FAILED";
  return fail(truth, lastReason, maxAttempts, { result, after });
}
