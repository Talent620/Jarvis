import { prisma } from "@/lib/prisma";
import { enrichLeadById } from "@/lib/acquisition/enrich";
import type { JobContext } from "./runner";

/**
 * Backfill enrichment for open leads that arrived without a website but have an
 * email we can derive one from. Bounded per run; rescoring happens inside
 * enrichLeadById.
 */
export async function enrichLeads({ companyId }: JobContext) {
  const leads = await prisma.lead.findMany({
    where: {
      companyId,
      deletedAt: null,
      outcome: "OPEN",
      website: null,
      email: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true },
  });

  let enriched = 0;
  for (const l of leads) {
    if (await enrichLeadById(companyId, l.id)) enriched++;
  }
  return { enriched, scanned: leads.length };
}
