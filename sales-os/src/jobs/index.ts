import { detectHotLeads } from "./detect-hot-leads";
import { performanceAlerts } from "./performance-alerts";
import { generateWeeklyReport } from "./weekly-report";
import { discoverNewLeads } from "./discover-leads";
import { enrichLeads } from "./enrich-leads";
import { advanceSequences } from "./advance-sequences";
import { auditWebsites } from "./audit-websites";
import { sendApprovedEmails } from "./send-approved-emails";
import { publishScheduledPosts } from "./publish-social";
import { runJobs, type JobContext, type JobHandler } from "./runner";

/**
 * The registered job set. Order matters for `runAllJobs`:
 * discovery → enrichment → qualification → sequence advance → delivery →
 * detection → alerts → reporting.
 * Each is also individually triggerable via POST /api/jobs/[name].
 */
export const JOBS: Record<string, JobHandler> = {
  "discover-leads": discoverNewLeads,
  "enrich-leads": enrichLeads,
  "audit-websites": auditWebsites,
  "advance-sequences": advanceSequences,
  "send-approved-emails": sendApprovedEmails,
  "publish-social": publishScheduledPosts,
  "detect-hot-leads": detectHotLeads,
  "performance-alerts": performanceAlerts,
  "weekly-report": generateWeeklyReport,
};

export async function runAllJobs(ctx: JobContext) {
  return runJobs(JOBS, ctx);
}

export {
  detectHotLeads,
  performanceAlerts,
  generateWeeklyReport,
  discoverNewLeads,
  enrichLeads,
  advanceSequences,
  auditWebsites,
  sendApprovedEmails,
  publishScheduledPosts,
};
export type { JobContext, JobResult } from "./runner";
