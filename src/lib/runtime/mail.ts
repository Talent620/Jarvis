// Mail with an external effect exactly once (mission 5.9). Every send has an action id, an
// idempotency key and an arguments hash. CONFIRMED only when the message is found in Sent.
// A timeout after a possible send is UNKNOWN_AFTER_ATTEMPT: Sent is read first, and only if the
// message is still absent after a re-check may a single retry happen.

import type { Kernel } from "./kernel";
import type { Truth } from "./truth";
import type { CapabilityState } from "./types";
import { hashArgs, preview } from "./util";

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
}

export interface SentRecord {
  id: string;
  to: string;
  subject: string;
  body: string;
  at: number;
}

export type SendOutcome =
  | { status: "sent"; providerId?: string }
  /** maybeSent: the request may have reached the provider (timeout, connection reset). */
  | { status: "failed"; error: string; maybeSent: boolean };

export interface MailService {
  readonly id: string;
  capabilities(): Promise<CapabilityState[]>;
  send(mail: OutgoingMail, signal?: AbortSignal): Promise<SendOutcome>;
  /** Read-back: the matching message in Sent since `since`, or null. */
  findSent(query: OutgoingMail & { since: number }): Promise<SentRecord | null>;
}

export interface SendSpec {
  taskId: string;
  stepId?: string;
  mail: OutgoingMail;
  /** Defaults to a hash of the final arguments: the same mail is the same effect. */
  idempotencyKey?: string;
}

export interface SendResult {
  actionId?: string;
  truth: Truth;
  evidence: string;
  reason?: string;
  sends: number;
  duplicate?: boolean;
}

export interface SendOptions {
  timeoutMs?: number;
  recheckDelayMs?: number;
  /** One retry after two negative read-backs (mission 5.9). */
  retryAfterReadback?: boolean;
  now?: () => number;
}

export const mailIdempotencyKey = (m: OutgoingMail): string => `mail:${hashArgs({ to: m.to.trim().toLowerCase(), subject: m.subject, body: m.body })}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<"timeout">((r) => { t = setTimeout(() => r("timeout"), ms); })]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function sendExactlyOnce(kernel: Kernel, mail: MailService, spec: SendSpec, opts: SendOptions = {}): Promise<SendResult> {
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const recheck = opts.recheckDelayMs ?? 1_500;
  const key = spec.idempotencyKey ?? mailIdempotencyKey(spec.mail);
  const since = now() - 24 * 3600_000;
  const step = (status: "running" | Truth, evidence?: string) => {
    if (spec.stepId) kernel.dispatch({ type: "TaskStepChanged", taskId: spec.taskId, stepId: spec.stepId, status, evidence });
  };
  const inSent = async (): Promise<SentRecord | null> => {
    try { return await mail.findSent({ ...spec.mail, since }); } catch { return null; }
  };
  const evidenceOf = (r: SentRecord) => `in Sent: ${r.id} to ${r.to}, "${preview(r.subject, 40)}"`;

  const actionId = kernel.id("mail");
  const started = kernel.dispatch({
    type: "ActionStarted", actionId, taskId: spec.taskId, stepId: spec.stepId, kind: "mail.send",
    argsHash: hashArgs(spec.mail), idempotencyKey: key, external: true,
  });
  if (!started.accepted) {
    // Same mail requested again (e.g. a repeated "wyślij"): never a second send.
    const prev = started.existingActionId ? kernel.state.actions[started.existingActionId] : undefined;
    if (prev?.status === "CONFIRMED") return { actionId: prev.id, truth: "CONFIRMED", evidence: prev.evidence ?? "", sends: 0, duplicate: true };
    const found = await inSent();
    if (found && prev) {
      kernel.dispatch({ type: "ActionVerified", actionId: prev.id, evidence: evidenceOf(found) });
      return { actionId: prev.id, truth: "CONFIRMED", evidence: evidenceOf(found), sends: 0, duplicate: true };
    }
    return { actionId: prev?.id, truth: "UNKNOWN_AFTER_ATTEMPT", evidence: "", reason: "the same mail was already attempted; not sending twice", sends: 0, duplicate: true };
  }
  step("running");

  // After a restart the mail may already be out: look before sending.
  const already = await inSent();
  if (already) {
    kernel.dispatch({ type: "ActionVerified", actionId, evidence: evidenceOf(already) });
    step("CONFIRMED", evidenceOf(already));
    return { actionId, truth: "CONFIRMED", evidence: evidenceOf(already), sends: 0 };
  }

  let sends = 0;
  const signal = kernel.signal(spec.taskId);
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (signal.aborted) {
      kernel.dispatch({ type: "ActionFailed", actionId, reason: "cancelled", truth: sends ? "UNKNOWN_AFTER_ATTEMPT" : "FAILED" });
      const t = kernel.state.actions[actionId].status as Truth;
      step(t, "cancelled");
      return { actionId, truth: t, evidence: "", reason: "cancelled", sends };
    }
    sends++;
    // Recorded before the request leaves: a crash mid-send restores as UNKNOWN_AFTER_ATTEMPT.
    kernel.dispatch({ type: "ActionAttempted", actionId, evidence: `send ${attempt} dispatched` });
    let out: SendOutcome | "timeout";
    try {
      out = await withTimeout(mail.send(spec.mail, signal), timeoutMs);
    } catch (e) {
      // A thrown provider error says nothing about whether the request got through.
      out = { status: "failed", error: e instanceof Error ? e.message : String(e), maybeSent: true };
    }
    if (out !== "timeout" && out.status === "failed" && !out.maybeSent) {
      // The provider rejected this request before sending. On the first attempt that is a clean
      // failure; on a retry the first attempt may still have gone out, so it stays unknown.
      kernel.dispatch({ type: "ActionFailed", actionId, reason: out.error, truth: "FAILED", definite: attempt === 1 });
      const t = kernel.state.actions[actionId].status as Truth;
      step(t, out.error);
      return { actionId, truth: t, evidence: "", reason: out.error, sends };
    }
    kernel.dispatch({ type: "ActionAttempted", actionId, evidence: out === "timeout" ? "timeout" : out.status === "sent" ? `provider id ${out.providerId ?? "?"}` : out.error });

    // Read-back: Sent, then a re-check after a short delay.
    let found = await inSent();
    if (!found) { await sleep(recheck); found = await inSent(); }
    if (found) {
      kernel.dispatch({ type: "ActionVerified", actionId, evidence: evidenceOf(found) });
      step("CONFIRMED", evidenceOf(found));
      return { actionId, truth: "CONFIRMED", evidence: evidenceOf(found), sends };
    }
    const reason = out === "timeout" ? "timeout after sending, not in Sent" : out.status === "sent" ? "provider said sent, not in Sent" : `${out.error}, not in Sent`;
    // Retry only when the provider did not confirm the send and Sent is empty twice over.
    if (attempt === 1 && out !== "timeout" && out.status === "sent") {
      kernel.dispatch({ type: "ActionFailed", actionId, reason, truth: "UNKNOWN_AFTER_ATTEMPT" });
      step("UNKNOWN_AFTER_ATTEMPT", reason);
      return { actionId, truth: "UNKNOWN_AFTER_ATTEMPT", evidence: "", reason, sends };
    }
    if (attempt === 1 && (opts.retryAfterReadback ?? true)) continue;
    kernel.dispatch({ type: "ActionFailed", actionId, reason, truth: "UNKNOWN_AFTER_ATTEMPT" });
    step("UNKNOWN_AFTER_ATTEMPT", reason);
    return { actionId, truth: "UNKNOWN_AFTER_ATTEMPT", evidence: "", reason, sends };
  }
  return { actionId, truth: "UNKNOWN_AFTER_ATTEMPT", evidence: "", reason: "unreachable", sends };
}
