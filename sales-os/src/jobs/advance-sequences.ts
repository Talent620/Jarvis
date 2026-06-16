import { advanceDueEnrollments } from "@/lib/acquisition/sequences";
import type { JobContext } from "./runner";

/**
 * Advance every due sequence step into the approval queue. Trigger from
 * cron/queue in production (or rely on the in-process scheduler in dev).
 */
export async function advanceSequences({ companyId }: JobContext) {
  return advanceDueEnrollments({ companyId, max: 50 });
}
