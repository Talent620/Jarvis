// The final truth of a coding task (mission M11). An agent finishing, or saying "done", proves
// nothing: CONFIRMED needs the repository's own checks to pass afterwards, history intact and no
// policy violation. Pure, so the same rule holds in the main process, the renderer and the tests.

import type { CoderResult, ValidationResult } from "./types";

export interface VerdictInput {
  ended: "completed" | "cancelled" | "crashed" | "timeout" | "unavailable" | "needs_auth" | "blocked";
  access: "read" | "write";
  agentSaysDone: boolean;
  validation?: ValidationResult;
  violations: string[];
  reason?: string;
}

export function decideVerdict(i: VerdictInput): Pick<CoderResult, "truth" | "partial" | "reason" | "state"> {
  const changed = i.validation?.changedFiles.length ?? 0;
  if (i.ended === "unavailable") return { state: "blocked", truth: "NEEDS_CAPABILITY", reason: i.reason ?? "no coding backend available" };
  if (i.ended === "needs_auth") return { state: "blocked", truth: "NEEDS_PERMISSION", reason: i.reason ?? "the backend needs you to log in" };
  if (i.violations.length) return { state: "blocked", truth: "BLOCKED", reason: `policy: ${i.violations.join("; ")}` };
  if (i.ended === "blocked") return { state: "blocked", truth: "BLOCKED", reason: i.reason };
  if (i.validation && !i.validation.historyIntact) return { state: "failed", truth: "FAILED", reason: "the branch history was rewritten" };
  if (i.ended === "cancelled") return { state: "cancelled", truth: changed ? "ATTEMPTED" : "FAILED", reason: i.reason ?? "stopped" };
  if (i.ended === "crashed" || i.ended === "timeout") {
    return { state: "failed", truth: changed ? "UNKNOWN_AFTER_ATTEMPT" : "FAILED", reason: i.reason ?? (i.ended === "timeout" ? "the agent did not finish in time" : "the agent process crashed") };
  }
  // Completed. A read-only role (plan, review) is done when its report arrived and nothing changed.
  if (i.access === "read") {
    return changed ? { state: "failed", truth: "FAILED", reason: "a read-only task changed files" } : { state: "completed", truth: "CONFIRMED" };
  }
  const v = i.validation;
  if (!v || !v.ran) return { state: "failed", truth: "ATTEMPTED", reason: "not validated" };
  if (v.noChecks) return { state: "completed", truth: "ATTEMPTED", reason: "the repository has no test, lint, typecheck or build command to prove the change" };
  const ok = v.checks.filter((c) => c.ok).length;
  if (ok === v.checks.length) {
    // The agent changed what judges it (a test script, a test config): passing proves nothing.
    if (v.checksChanged?.length) return { state: "completed", truth: "ATTEMPTED", reason: `the agent changed how the project is checked (${v.checksChanged.join(", ")})` };
    // Nothing changed: green checks only show the project was already green.
    if (!changed) return { state: "completed", truth: "ATTEMPTED", reason: "the agent changed nothing" };
    return { state: "completed", truth: "CONFIRMED" };
  }
  const failed = v.checks.filter((c) => !c.ok).map((c) => c.name).join(", ");
  const why = i.agentSaysDone ? `the agent said it was done, but ${failed} failed` : `${failed} failed`;
  return { state: "failed", truth: "FAILED", partial: ok > 0, reason: why };
}
