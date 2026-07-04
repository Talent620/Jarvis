import { prisma } from "@/lib/prisma";
import { auditLead } from "@/lib/audit";
import type { JobContext } from "./runner";

/**
 * Qualify leads by website health: pick a small batch of leads that have a
 * website but no audit yet and run the audit (PageSpeed or heuristic). Small
 * batches keep the tick fast — the autopilot sweeps the backlog over time.
 */
export async function auditWebsites(ctx: JobContext, max = 3) {
  const leads = await prisma.lead.findMany({
    where: {
      companyId: ctx.companyId,
      deletedAt: null,
      outcome: "OPEN",
      website: { not: null },
      auditScore: null,
      audits: { none: {} },
    },
    orderBy: { createdAt: "desc" },
    take: max,
    select: { id: true },
  });

  let audited = 0;
  for (const lead of leads) {
    try {
      if (await auditLead({ companyId: ctx.companyId, leadId: lead.id })) audited++;
    } catch (e) {
      console.error("[jobs] audit failed for lead", lead.id, e);
    }
  }
  return { audited };
}
