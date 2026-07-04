import { prisma } from "@/lib/prisma";
import { HOT_LEAD_THRESHOLD } from "@/lib/constants";
import type { JobContext } from "./runner";

/**
 * Surface leads that have crossed the "hot" threshold and don't yet have a
 * standing notification, so the operator gets nudged exactly once per lead.
 */
export async function detectHotLeads({ companyId }: JobContext) {
  const hot = await prisma.lead.findMany({
    where: { companyId, deletedAt: null, outcome: "OPEN", score: { gte: HOT_LEAD_THRESHOLD } },
    select: { id: true, name: true, companyName: true, score: true },
  });
  if (hot.length === 0) return { created: 0 };

  const existing = await prisma.notification.findMany({
    where: { companyId, type: "HOT_LEAD" },
    select: { link: true },
  });
  const notified = new Set(existing.map((n) => n.link));

  const toCreate = hot.filter((l) => !notified.has(`/leads/${l.id}`));
  if (toCreate.length === 0) return { created: 0 };

  await prisma.notification.createMany({
    data: toCreate.map((l) => ({
      companyId,
      type: "HOT_LEAD" as const,
      title: `Hot lead: ${l.name}`,
      body: `${l.companyName ?? "Lead"} reached a score of ${l.score}. Reach out before it cools.`,
      link: `/leads/${l.id}`,
    })),
  });

  return { created: toCreate.length };
}
