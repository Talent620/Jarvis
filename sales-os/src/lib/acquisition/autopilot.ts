import type { AcquisitionTrigger, LeadSource, RunStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/activity";
import { ensureAcquisitionSettings, isWithinQuietHours } from "./settings";
import { discoverForAllAudiences, type MultiDiscoverResult } from "./discover";
import { enrichLeadById } from "./enrich";
import { advanceDueEnrollments, enrollEligibleLeads, enrollLead } from "./sequences";
import { detectHotLeads } from "@/jobs/detect-hot-leads";
import { performanceAlerts } from "@/jobs/performance-alerts";
import { prospectForCompany } from "@/lib/prospecting";
import { auditWebsites } from "@/jobs/audit-websites";
import { autoSendPendingEmails } from "@/lib/email/outreach";
import { publishDuePosts } from "@/lib/social";

const OUTBOUND_SOURCES: LeadSource[] = ["COLD_OUTREACH", "LINKEDIN", "MARKETPLACE", "FACEBOOK_GROUP"];

export interface TickResult {
  runId: string;
  status: RunStatus;
  skippedReason?: string;
  discovered: number;
  created: number;
  deduped: number;
  enriched: number;
  drafted: number;
  enrolled: number;
  advanced: number;
  hotDetected: number;
  durationMs: number;
}

function utcDayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Run one autonomous acquisition tick for a single company. This is the brain:
 * it respects the master switch, cadence, quiet hours and the daily cap, then
 * sources prospects across all ICPs, enriches them, enrolls them into the
 * outreach cadence (or queues a first-touch draft), advances any due sequence
 * steps, and surfaces hot leads — writing a full AcquisitionRun audit row.
 *
 * Human-in-the-loop is preserved end-to-end: every message it produces lands in
 * the approval queue. Nothing is ever sent automatically.
 */
export async function runAcquisitionTick(args: {
  companyId: string;
  trigger: AcquisitionTrigger;
}): Promise<TickResult> {
  const { companyId, trigger } = args;
  const start = Date.now();
  const manual = trigger === "MANUAL";

  const settings = await ensureAcquisitionSettings(companyId);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { timezone: true },
  });
  const tz = company?.timezone ?? "Europe/Warsaw";

  const writeSkipped = async (reason: string): Promise<TickResult> => {
    const run = await prisma.acquisitionRun.create({
      data: {
        companyId,
        trigger,
        status: "SKIPPED",
        durationMs: Date.now() - start,
        detail: { reason },
      },
    });
    return {
      runId: run.id, status: "SKIPPED", skippedReason: reason,
      discovered: 0, created: 0, deduped: 0, enriched: 0, drafted: 0,
      enrolled: 0, advanced: 0, hotDetected: 0, durationMs: run.durationMs,
    };
  };

  // --- Guards (cron/startup only; manual always runs) ---
  if (!settings.enabled && !manual) return writeSkipped("autopilot disabled");

  if (!manual && settings.lastRunAt) {
    const elapsedMin = (Date.now() - new Date(settings.lastRunAt).getTime()) / 60_000;
    if (elapsedMin < settings.cadenceMinutes) {
      return writeSkipped(`cadence: ${Math.ceil(settings.cadenceMinutes - elapsedMin)}m to next run`);
    }
  }

  const quiet = !manual && isWithinQuietHours(settings, tz);

  try {
    const dayStart = utcDayStart();
    const createdToday = await prisma.lead.count({
      where: {
        companyId,
        deletedAt: null,
        source: { in: OUTBOUND_SOURCES },
        createdAt: { gte: dayStart },
      },
    });
    const remainingToCap = Math.max(0, settings.dailyLeadCap - createdToday);

    const audienceCount = await prisma.audience.count({
      where: { companyId, deletedAt: null, active: true },
    });
    const audienceSlots = Math.max(1, audienceCount);

    // --- 1. Discovery (paced toward target; bounded by the hard cap & quiet hours) ---
    let discovery: MultiDiscoverResult = {
      totalFound: 0, totalCreated: 0, totalDeduped: 0, createdLeadIds: [],
      perAudience: [], providerNames: [], live: false,
    };
    let discoverySkipped: string | null = null;

    const softRemaining = manual
      ? remainingToCap
      : Math.max(0, Math.min(remainingToCap, settings.targetPerDay - createdToday));
    const budget = Math.min(softRemaining, settings.perRunBatch * audienceSlots);

    if (quiet) discoverySkipped = "quiet hours";
    else if (remainingToCap <= 0) discoverySkipped = "daily cap reached";
    else if (budget <= 0) discoverySkipped = "daily target reached";
    else {
      // When auto-enrolling, the sequence's first step is the first touch, so we
      // don't also draft in ingest (avoids a duplicate first message).
      const autoDraft = settings.autoDraftOutbound && !settings.autoEnroll;
      discovery = await discoverForAllAudiences({
        companyId,
        perAudience: settings.perRunBatch,
        budget,
        autoDraft,
      });
    }

    // --- 1b. Local-business prospecting (Google Maps / registries) ---
    let prospecting = { created: 0, deduped: 0, audited: 0, found: 0, createdLeadIds: [] as string[] };
    if (
      settings.prospectingEnabled &&
      settings.prospectingQueries.length > 0 &&
      !quiet &&
      remainingToCap - discovery.totalCreated > 0
    ) {
      const r = await prospectForCompany({
        companyId,
        queries: settings.prospectingQueries,
        noWebsiteOnly: settings.prospectingNoWebsiteOnly,
        budget: Math.min(remainingToCap - discovery.totalCreated, settings.perRunBatch * 2),
        autoDraft: settings.autoDraftOutbound && !settings.autoEnroll,
        autoAudit: false, // audits run in their own step below (slow API)
      });
      prospecting = { ...r };
      discovery.createdLeadIds.push(...r.createdLeadIds);
    }

    // --- 2. Enrich newly-created leads ---
    let enriched = 0;
    if (settings.enrichLeads) {
      for (const leadId of discovery.createdLeadIds) {
        if (await enrichLeadById(companyId, leadId)) enriched++;
      }
    }

    // --- 2b. Website qualification audits (small batch per tick) ---
    let audited = 0;
    if (settings.auditWebsites) {
      const r = await auditWebsites({ companyId }, 3).catch(() => ({ audited: 0 }));
      audited = r.audited;
    }

    // --- 3. Enroll into the outreach cadence ---
    let enrolled = 0;
    if (settings.autoEnroll && !quiet) {
      for (const leadId of discovery.createdLeadIds) {
        const e = await enrollLead({ companyId, leadId });
        if (e) enrolled++;
      }
      // Sweep any earlier outbound leads that never got enrolled.
      const sweep = await enrollEligibleLeads({ companyId, max: Math.max(5, settings.perRunBatch) });
      enrolled += sweep.enrolled;
    }

    // --- 4. Advance due sequence steps (drafts → approvals) ---
    let advanced = 0;
    let drafted = 0;
    if (!quiet) {
      const adv = await advanceDueEnrollments({ companyId, max: 25 });
      advanced = adv.advanced;
      drafted = adv.drafted;
    }

    // --- 4b. Real delivery (only when the owner enabled full automation) ---
    let emailsSent = 0;
    if (settings.autoSendEmails && !quiet) {
      const r = await autoSendPendingEmails({
        companyId,
        dailyEmailCap: settings.dailyEmailCap,
      }).catch(() => ({ sent: 0, failed: 0, skipped: 0 }));
      emailsSent = r.sent;
    }

    // --- 4c. Publish any due scheduled social posts ---
    const social = await publishDuePosts(companyId).catch(() => ({ published: 0, failed: 0 }));

    // --- 5. Detection + health alerts ---
    const [hot] = await Promise.all([
      detectHotLeads({ companyId }).catch(() => ({ created: 0 })),
      performanceAlerts({ companyId }).catch(() => ({ raised: false })),
    ]);
    const hotDetected = (hot as { created: number }).created ?? 0;

    // --- 6. Persist run audit + bookkeeping ---
    const durationMs = Date.now() - start;
    const status: RunStatus = "SUCCESS";

    const run = await prisma.acquisitionRun.create({
      data: {
        companyId,
        trigger,
        status,
        discovered: discovery.totalFound + prospecting.found,
        created: discovery.totalCreated + prospecting.created,
        deduped: discovery.totalDeduped + prospecting.deduped,
        enriched,
        drafted,
        enrolled,
        advanced,
        hotDetected,
        durationMs,
        detail: {
          quiet,
          discoverySkipped,
          prospecting: {
            found: prospecting.found,
            created: prospecting.created,
            deduped: prospecting.deduped,
          },
          audited,
          emailsSent,
          socialPublished: social.published,
          createdToday: createdToday + discovery.totalCreated + prospecting.created,
          dailyLeadCap: settings.dailyLeadCap,
          targetPerDay: settings.targetPerDay,
          providers: discovery.providerNames,
          live: discovery.live,
          perAudience: discovery.perAudience.map((a) => ({
            audience: a.audience,
            found: a.found,
            created: a.created,
            deduped: a.deduped,
          })),
        },
      },
    });

    await prisma.acquisitionSettings.update({
      where: { companyId },
      data: { lastRunAt: new Date() },
    });

    // Daily discovered metric (idempotent per day).
    await prisma.metricSnapshot.upsert({
      where: { companyId_key_date: { companyId, key: "acq.discovered", date: dayStart } },
      create: { companyId, key: "acq.discovered", date: dayStart, value: discovery.totalCreated },
      update: { value: { increment: discovery.totalCreated } },
    });

    const totalNewLeads = discovery.totalCreated + prospecting.created;
    if (totalNewLeads > 0 || drafted > 0 || emailsSent > 0) {
      const bits = [
        totalNewLeads ? `${totalNewLeads} new lead${totalNewLeads === 1 ? "" : "s"}` : "",
        drafted ? `${drafted} draft${drafted === 1 ? "" : "s"} queued` : "",
        enrolled ? `${enrolled} enrolled` : "",
        emailsSent ? `${emailsSent} email${emailsSent === 1 ? "" : "s"} auto-sent` : "",
        audited ? `${audited} site${audited === 1 ? "" : "s"} audited` : "",
      ].filter(Boolean);
      await notify({
        companyId,
        type: "SYSTEM",
        title: "Acquisition autopilot ran",
        body: `${bits.join(" · ")}${discovery.live ? "" : " · sample data"}. Review drafts in Approvals.`,
        link: drafted ? "/approvals" : "/leads",
      });
    }

    return {
      runId: run.id, status,
      discovered: discovery.totalFound + prospecting.found,
      created: discovery.totalCreated + prospecting.created,
      deduped: discovery.totalDeduped + prospecting.deduped,
      enriched, drafted, enrolled, advanced, hotDetected, durationMs,
    };
  } catch (e) {
    const durationMs = Date.now() - start;
    const message = e instanceof Error ? e.message : String(e);
    console.error("[autopilot] tick failed:", e);
    const run = await prisma.acquisitionRun.create({
      data: { companyId, trigger, status: "ERROR", durationMs, error: message.slice(0, 500) },
    });
    return {
      runId: run.id, status: "ERROR",
      discovered: 0, created: 0, deduped: 0, enriched: 0, drafted: 0,
      enrolled: 0, advanced: 0, hotDetected: 0, durationMs,
    };
  }
}

/** Run a tick for every company — used by the cron endpoint and the in-process scheduler. */
export async function runAcquisitionTickForAllCompanies(
  trigger: AcquisitionTrigger,
): Promise<{ companies: number; results: { companyId: string; status: RunStatus }[] }> {
  const companies = await prisma.company.findMany({ select: { id: true } });
  const results: { companyId: string; status: RunStatus }[] = [];
  for (const c of companies) {
    try {
      const r = await runAcquisitionTick({ companyId: c.id, trigger });
      results.push({ companyId: c.id, status: r.status });
    } catch (e) {
      console.error("[autopilot] company tick failed:", c.id, e);
      results.push({ companyId: c.id, status: "ERROR" });
    }
  }
  return { companies: companies.length, results };
}
