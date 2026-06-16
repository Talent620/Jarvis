import { ensureAcquisitionSettings } from "@/lib/acquisition/settings";
import { autoSendPendingEmails } from "@/lib/email/outreach";
import type { JobContext } from "./runner";

/**
 * Full-automation email delivery: when the owner has enabled `autoSendEmails`,
 * auto-approve + send pending AI email drafts up to the daily cap. With the
 * flag off (the default) this is a no-op and the approval queue stays manual.
 */
export async function sendApprovedEmails(ctx: JobContext) {
  const settings = await ensureAcquisitionSettings(ctx.companyId);
  if (!settings.autoSendEmails) return { sent: 0, failed: 0, skipped: 0 };
  return autoSendPendingEmails({
    companyId: ctx.companyId,
    dailyEmailCap: settings.dailyEmailCap,
  });
}
