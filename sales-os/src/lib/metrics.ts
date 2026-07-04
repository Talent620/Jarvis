import { prisma } from "@/lib/prisma";
import { HOT_LEAD_THRESHOLD } from "@/lib/constants";
import type { MockCopilotSnapshot } from "@/lib/ai/mock";

/**
 * Single source of truth for the headline KPIs. Used by the dashboard, the
 * analytics page, the Copilot grounding snapshot and the weekly report so the
 * numbers never disagree across the product.
 */
export async function computeSnapshot(companyId: string): Promise<MockCopilotSnapshot> {
  const now = new Date();

  const [
    company,
    totalLeads,
    hotLeads,
    openTasks,
    overdueTasks,
    pendingApprovals,
    wonAgg,
    pipelineAgg,
    campaignAgg,
  ] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { currency: true } }),
    prisma.lead.count({ where: { companyId, deletedAt: null } }),
    prisma.lead.count({
      where: { companyId, deletedAt: null, outcome: "OPEN", score: { gte: HOT_LEAD_THRESHOLD } },
    }),
    prisma.task.count({
      where: { companyId, deletedAt: null, status: { in: ["TODO", "IN_PROGRESS"] } },
    }),
    prisma.task.count({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ["TODO", "IN_PROGRESS"] },
        dueDate: { lt: now },
      },
    }),
    prisma.approvalRequest.count({ where: { companyId, status: "PENDING" } }),
    prisma.lead.aggregate({
      where: { companyId, deletedAt: null, outcome: "WON" },
      _sum: { estimatedValue: true },
    }),
    prisma.lead.aggregate({
      where: { companyId, deletedAt: null, outcome: "OPEN" },
      _sum: { estimatedValue: true },
    }),
    prisma.campaign.aggregate({
      where: { companyId, deletedAt: null },
      _sum: { sentCount: true, repliedCount: true },
    }),
  ]);

  const sent = campaignAgg._sum.sentCount ?? 0;
  const replied = campaignAgg._sum.repliedCount ?? 0;
  const replyRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;

  return {
    totalLeads,
    hotLeads,
    openTasks,
    overdueTasks,
    pendingApprovals,
    wonValue: wonAgg._sum.estimatedValue ?? 0,
    pipelineValue: pipelineAgg._sum.estimatedValue ?? 0,
    replyRate,
    currency: company?.currency ?? "PLN",
  };
}

export interface FunnelDatum {
  stage: string;
  count: number;
  color: string;
}

/** Lead counts per pipeline stage, ordered, for the funnel chart. */
export async function funnelDistribution(companyId: string): Promise<FunnelDatum[]> {
  const stages = await prisma.funnelStage.findMany({
    where: { companyId },
    orderBy: { order: "asc" },
    select: { id: true, name: true, color: true },
  });
  const counts = await prisma.lead.groupBy({
    by: ["stageId"],
    where: { companyId, deletedAt: null },
    _count: { _all: true },
  });
  const map = new Map(counts.map((c) => [c.stageId, c._count._all]));
  return stages.map((s) => ({ stage: s.name, count: map.get(s.id) ?? 0, color: s.color }));
}

export interface SourceDatum {
  source: string;
  count: number;
}

/** Lead counts per acquisition source. */
export async function sourceDistribution(companyId: string): Promise<SourceDatum[]> {
  const rows = await prisma.lead.groupBy({
    by: ["source"],
    where: { companyId, deletedAt: null },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ source: r.source, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}
