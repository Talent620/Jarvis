import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { CallsClient } from "@/components/calls/calls-client";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  const { companyId } = a.ctx;

  const dayEnd = new Date();
  dayEnd.setHours(23, 59, 59, 999);

  const [leads, callsToday, meetingsBooked, interested] = await Promise.all([
    prisma.lead.findMany({
      where: {
        companyId,
        deletedAt: null,
        outcome: "OPEN",
        phone: { not: null },
        callStatus: { notIn: ["NOT_INTERESTED", "WRONG_NUMBER"] },
      },
      orderBy: [{ callStatus: "asc" }, { score: "desc" }],
      take: 200,
      select: {
        id: true,
        name: true,
        companyName: true,
        phone: true,
        score: true,
        scoreGrade: true,
        callStatus: true,
        callAttempts: true,
        lastCallAt: true,
        nextCallAt: true,
        hasWebsite: true,
        auditScore: true,
        industry: true,
        region: true,
        tags: true,
        callLogs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { note: true, status: true, createdAt: true },
        },
        audits: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { overall: true, summary: true, issues: true },
        },
      },
    }),
    prisma.callLog.count({
      where: {
        companyId,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.lead.count({
      where: { companyId, deletedAt: null, callStatus: "MEETING_BOOKED" },
    }),
    prisma.lead.count({
      where: { companyId, deletedAt: null, callStatus: "INTERESTED" },
    }),
  ]);

  return (
    <CallsClient
      leads={leads.map((l) => ({
        id: l.id,
        name: l.name,
        companyName: l.companyName,
        phone: l.phone!,
        score: l.score,
        scoreGrade: l.scoreGrade,
        callStatus: l.callStatus,
        callAttempts: l.callAttempts,
        lastCallAt: l.lastCallAt?.toISOString() ?? null,
        nextCallAt: l.nextCallAt?.toISOString() ?? null,
        hasWebsite: l.hasWebsite,
        auditScore: l.auditScore,
        industry: l.industry,
        region: l.region,
        tags: l.tags,
        lastNote: l.callLogs[0]?.note ?? null,
        audit: l.audits[0]
          ? { overall: l.audits[0].overall, summary: l.audits[0].summary, issues: l.audits[0].issues }
          : null,
      }))}
      kpis={{ callsToday, meetingsBooked, interested }}
    />
  );
}
