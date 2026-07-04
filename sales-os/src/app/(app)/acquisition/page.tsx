import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ensureInboundIntegration } from "@/lib/acquisition/token";
import { ensureAcquisitionSettings } from "@/lib/acquisition/settings";
import { AcquisitionClient } from "@/components/acquisition/acquisition-client";

export const dynamic = "force-dynamic";

const INBOUND_SOURCES = ["INBOUND_FORM", "ADS", "WEBSITE"] as const;
const OUTBOUND_SOURCES = ["COLD_OUTREACH", "LINKEDIN", "MARKETPLACE", "FACEBOOK_GROUP"] as const;

export default async function AcquisitionPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  const { companyId } = a.ctx;

  const integ = await ensureInboundIntegration(companyId);
  const cfg = (integ.config ?? {}) as Record<string, unknown>;
  const token = typeof cfg.token === "string" ? cfg.token : "";
  const autoDraft = cfg.autoDraft === true;

  const settings = await ensureAcquisitionSettings(companyId);

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const [
    audiences,
    inboundCount,
    outboundCount,
    recent,
    runs,
    sequences,
    activeEnrollGroups,
    capturedToday,
    pendingApprovals,
    activeEnrollments,
  ] = await Promise.all([
    prisma.audience.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, industry: true, region: true },
    }),
    prisma.lead.count({
      where: { companyId, deletedAt: null, source: { in: [...INBOUND_SOURCES] } },
    }),
    prisma.lead.count({
      where: { companyId, deletedAt: null, source: { in: [...OUTBOUND_SOURCES] } },
    }),
    prisma.lead.findMany({
      where: {
        companyId,
        deletedAt: null,
        source: { in: [...INBOUND_SOURCES, ...OUTBOUND_SOURCES] },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        name: true,
        companyName: true,
        source: true,
        score: true,
        scoreGrade: true,
        createdAt: true,
      },
    }),
    prisma.acquisitionRun.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.sequence.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: {
        steps: { orderBy: { order: "asc" } },
        _count: { select: { enrollments: true } },
      },
    }),
    prisma.sequenceEnrollment.groupBy({
      by: ["sequenceId"],
      where: { companyId, status: "ACTIVE" },
      _count: { _all: true },
    }),
    prisma.lead.count({
      where: {
        companyId,
        deletedAt: null,
        source: { in: [...OUTBOUND_SOURCES] },
        createdAt: { gte: dayStart },
      },
    }),
    prisma.approvalRequest.count({ where: { companyId, status: "PENDING" } }),
    prisma.sequenceEnrollment.count({ where: { companyId, status: "ACTIVE" } }),
  ]);

  const activeMap = new Map(activeEnrollGroups.map((r) => [r.sequenceId, r._count._all]));

  const providerName = process.env.APOLLO_API_KEY
    ? "apollo"
    : process.env.HUNTER_API_KEY
      ? "hunter"
      : "mock";

  return (
    <AcquisitionClient
      token={token}
      autoDraft={autoDraft}
      baseUrl={process.env.NEXTAUTH_URL ?? ""}
      audiences={audiences}
      provider={{ name: providerName, live: providerName !== "mock" }}
      recent={recent.map((l) => ({
        id: l.id,
        name: l.name,
        companyName: l.companyName,
        source: l.source,
        score: l.score,
        grade: l.scoreGrade,
        createdAt: l.createdAt.toISOString(),
      }))}
      settings={{
        enabled: settings.enabled,
        cadenceMinutes: settings.cadenceMinutes,
        dailyLeadCap: settings.dailyLeadCap,
        targetPerDay: settings.targetPerDay,
        perRunBatch: settings.perRunBatch,
        autoDraftInbound: settings.autoDraftInbound,
        autoDraftOutbound: settings.autoDraftOutbound,
        autoEnroll: settings.autoEnroll,
        enrichLeads: settings.enrichLeads,
        minScoreToDraft: settings.minScoreToDraft,
        channels: settings.channels,
        quietHoursStart: settings.quietHoursStart,
        quietHoursEnd: settings.quietHoursEnd,
        autoSendEmails: settings.autoSendEmails,
        dailyEmailCap: settings.dailyEmailCap,
        auditWebsites: settings.auditWebsites,
        lastRunAt: settings.lastRunAt ? settings.lastRunAt.toISOString() : null,
      }}
      runs={runs.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        status: r.status,
        discovered: r.discovered,
        created: r.created,
        deduped: r.deduped,
        enriched: r.enriched,
        drafted: r.drafted,
        enrolled: r.enrolled,
        advanced: r.advanced,
        hotDetected: r.hotDetected,
        durationMs: r.durationMs,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
        detail: (r.detail ?? null) as { reason?: string; live?: boolean } | null,
      }))}
      sequences={sequences.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        channel: s.channel,
        active: s.active,
        isDefault: s.isDefault,
        steps: s.steps.map((st) => ({
          id: st.id,
          order: st.order,
          dayOffset: st.dayOffset,
          channel: st.channel,
          kind: st.kind,
          name: st.name,
        })),
        activeEnrollments: activeMap.get(s.id) ?? 0,
        enrollments: s._count.enrollments,
      }))}
      stats={{
        capturedToday,
        pendingApprovals,
        activeEnrollments,
        inbound: inboundCount,
        outbound: outboundCount,
      }}
    />
  );
}
