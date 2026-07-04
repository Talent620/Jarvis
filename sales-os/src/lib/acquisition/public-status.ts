import { prisma } from "@/lib/prisma";
import { recomputeLeadScore } from "@/lib/lead-service";

/** JARVIS lead statuses that can be pushed back to the funnel. */
export type JarvisStatus = "new" | "contacted" | "offer" | "won" | "lost";

export const JARVIS_STATUSES: JarvisStatus[] = ["new", "contacted", "offer", "won", "lost"];

/** Pick the destination funnel stage for a JARVIS status (best-effort by flag/name). */
async function resolveStage(companyId: string, status: JarvisStatus) {
  if (status === "won") {
    return prisma.funnelStage.findFirst({ where: { companyId, isWon: true }, orderBy: { order: "asc" } });
  }
  if (status === "lost") {
    return prisma.funnelStage.findFirst({ where: { companyId, isLost: true }, orderBy: { order: "asc" } });
  }
  // Map the remaining statuses onto the default funnel names (case-insensitive),
  // with sensible fallbacks when stages were renamed.
  const names: Record<Exclude<JarvisStatus, "won" | "lost">, string[]> = {
    new: ["New"],
    contacted: ["Contacted", "Qualified"],
    offer: ["Proposal", "Negotiation"],
  };
  for (const name of names[status]) {
    const stage = await prisma.funnelStage.findFirst({
      where: { companyId, name: { equals: name, mode: "insensitive" }, isWon: false, isLost: false },
    });
    if (stage) return stage;
  }
  return null;
}

export interface StatusResult {
  leadId: string;
  status: JarvisStatus;
  stage: string | null;
  outcome: "OPEN" | "WON" | "LOST";
}

/**
 * Apply a JARVIS lead status to a Sales OS lead — moves it to the matching
 * funnel stage, derives the outcome, logs a STAGE_CHANGE and rescoring. This is
 * the JARVIS → CRM half of two-way status sync.
 */
export async function applyJarvisStatus(args: {
  companyId: string;
  leadId: string;
  status: JarvisStatus;
}): Promise<StatusResult> {
  const lead = await prisma.lead.findFirst({
    where: { id: args.leadId, companyId: args.companyId, deletedAt: null },
    include: { stage: true },
  });
  if (!lead) throw new Error("lead not found");

  const stage = await resolveStage(args.companyId, args.status);
  const outcome: "OPEN" | "WON" | "LOST" =
    args.status === "won" ? "WON" : args.status === "lost" ? "LOST" : "OPEN";

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...(stage ? { stageId: stage.id } : {}),
      outcome,
      ...(outcome === "OPEN" ? { lastContactedAt: new Date() } : {}),
    },
  });

  await prisma.leadActivity.create({
    data: {
      companyId: args.companyId,
      leadId: lead.id,
      type: "STAGE_CHANGE",
      title: stage ? `Moved to ${stage.name} (JARVIS)` : `Outcome → ${outcome} (JARVIS)`,
      body: lead.stage ? `From ${lead.stage.name}` : undefined,
      meta: { from: lead.stage?.name ?? null, to: stage?.name ?? outcome, via: "JARVIS" },
    },
  });

  await recomputeLeadScore(updated);

  return { leadId: lead.id, status: args.status, stage: stage?.name ?? null, outcome };
}
