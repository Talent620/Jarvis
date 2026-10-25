// Runtime truth states (mission rule 3). A superset of ActionOutcome: the runtime needs to say
// "we tried and do not know" (UNKNOWN_AFTER_ATTEMPT) and "we could not even try"
// (BLOCKED / NEEDS_*). CONFIRMED is only ever produced after a matching read-back.

import type { ActionOutcome } from "../actionOutcome";
import { attempted, confirmed, draft, failed, simulated } from "../actionOutcome";

export type Truth =
  | "SIMULATED"
  | "ATTEMPTED"
  | "CONFIRMED"
  | "UNKNOWN_AFTER_ATTEMPT"
  | "FAILED"
  | "BLOCKED"
  | "NEEDS_PERMISSION"
  | "NEEDS_HARDWARE"
  | "NEEDS_CAPABILITY";

export const TRUTHS: readonly Truth[] = [
  "SIMULATED", "ATTEMPTED", "CONFIRMED", "UNKNOWN_AFTER_ATTEMPT", "FAILED",
  "BLOCKED", "NEEDS_PERMISSION", "NEEDS_HARDWARE", "NEEDS_CAPABILITY",
];

/** Only CONFIRMED may be presented to the user as "done". */
export const isSuccess = (t: Truth | undefined): boolean => t === "CONFIRMED";

/** States in which an external effect may already have happened. Never blindly retry these. */
export const mayHaveEffect = (t: Truth | undefined): boolean => t === "ATTEMPTED" || t === "UNKNOWN_AFTER_ATTEMPT" || t === "CONFIRMED";

/** States in which nothing was attempted because something is missing. */
export const isPrecondition = (t: Truth | undefined): boolean =>
  t === "BLOCKED" || t === "NEEDS_PERMISSION" || t === "NEEDS_HARDWARE" || t === "NEEDS_CAPABILITY";

/** Map to the legacy ActionOutcome contract used by agentRun, goalState and the UI. */
export function toActionOutcome(t: Truth, message?: string, source?: string): ActionOutcome {
  switch (t) {
    case "CONFIRMED": return confirmed({ source, message });
    case "SIMULATED": return simulated(message);
    case "ATTEMPTED":
    case "UNKNOWN_AFTER_ATTEMPT": return attempted(source, message ?? (t === "UNKNOWN_AFTER_ATTEMPT" ? "outcome unknown after attempt" : undefined));
    case "FAILED": return failed(message, source);
    default: return draft(message ?? t);
  }
}
