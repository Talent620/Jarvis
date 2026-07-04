import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeSnapshot, funnelDistribution } from "@/lib/metrics";
import { formatCurrency } from "@/lib/utils";
import type { JobContext } from "./runner";

/**
 * Build a weekly performance report: compute KPIs, write a human-readable
 * narrative, persist a Report row and notify the team it's ready.
 */
export async function generateWeeklyReport({ companyId }: JobContext) {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 86_400_000);

  const [snapshot, funnel, newLeads, wonCount] = await Promise.all([
    computeSnapshot(companyId),
    funnelDistribution(companyId),
    prisma.lead.count({ where: { companyId, deletedAt: null, createdAt: { gte: periodStart } } }),
    prisma.lead.count({
      where: { companyId, deletedAt: null, outcome: "WON", updatedAt: { gte: periodStart } },
    }),
  ]);

  const c = snapshot.currency;
  const summary = [
    `This week: ${newLeads} new lead${newLeads === 1 ? "" : "s"}, ${wonCount} won.`,
    `Pipeline stands at ${formatCurrency(snapshot.pipelineValue, c)} across ${snapshot.totalLeads} leads (${snapshot.hotLeads} hot).`,
    `Won to date: ${formatCurrency(snapshot.wonValue, c)}. Reply rate: ${snapshot.replyRate}%.`,
    snapshot.overdueTasks > 0
      ? `${snapshot.overdueTasks} task${snapshot.overdueTasks === 1 ? " is" : "s are"} overdue — clearing these is the fastest win.`
      : "No overdue tasks — follow-up discipline is on track.",
  ].join(" ");

  const report = await prisma.report.create({
    data: {
      companyId,
      type: "WEEKLY",
      title: `Weekly report · ${periodStart.toLocaleDateString("en-GB")}–${periodEnd.toLocaleDateString("en-GB")}`,
      summary,
      data: { snapshot, funnel, newLeads, wonCount } as unknown as Prisma.InputJsonValue,
      periodStart,
      periodEnd,
    },
  });

  await prisma.notification.create({
    data: {
      companyId,
      type: "REPORT_READY",
      title: "Weekly report is ready",
      body: summary.slice(0, 160),
      link: "/analytics",
    },
  });

  return report;
}
