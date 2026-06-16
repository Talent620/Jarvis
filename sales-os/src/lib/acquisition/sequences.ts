import type { CampaignChannel, ContentKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { generateContent, logAiDecision } from "@/lib/ai";
import { auditDraftContext } from "@/lib/audit";

const DAY_MS = 86_400_000;

/** Outbound channels whose leads are eligible for sequence auto-enrollment. */
const OUTBOUND_SOURCES = ["COLD_OUTREACH", "LINKEDIN", "MARKETPLACE", "FACEBOOK_GROUP"] as const;

interface StepSpec {
  order: number;
  dayOffset: number;
  channel: CampaignChannel;
  kind: ContentKind;
  name: string;
  prompt: string;
}

/** A sensible 4-touch cold cadence used when no sequence has been defined yet. */
export const DEFAULT_SEQUENCE_STEPS: StepSpec[] = [
  {
    order: 1, dayOffset: 0, channel: "EMAIL", kind: "EMAIL", name: "Intro email",
    prompt:
      "First-touch cold email. Open with genuine relevance to their context or buying signals, make one specific value point, and end with a soft ask for a short call. Under 110 words, no false familiarity.",
  },
  {
    order: 2, dayOffset: 2, channel: "EMAIL", kind: "FOLLOW_UP", name: "Value bump",
    prompt:
      "Short follow-up to the intro email. Add one new proof point or angle and a single soft CTA. Under 60 words.",
  },
  {
    order: 3, dayOffset: 3, channel: "LINKEDIN", kind: "DM", name: "LinkedIn touch",
    prompt:
      "Brief, friendly LinkedIn DM referencing the same value point. Ask one qualifying question; do not dump a pitch.",
  },
  {
    order: 4, dayOffset: 4, channel: "EMAIL", kind: "FOLLOW_UP", name: "Break-up",
    prompt:
      "Polite break-up email. Acknowledge the timing might be off, leave the door open, and make it easy to say 'not now'. Under 70 words.",
  },
];

/** Get the company's default sequence (with steps), creating it on first use. */
export async function ensureDefaultSequence(companyId: string) {
  const existing = await prisma.sequence.findFirst({
    where: { companyId, deletedAt: null, isDefault: true },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (existing) return existing;

  const [offer, audience] = await Promise.all([
    prisma.offer.findFirst({
      where: { companyId, deletedAt: null, active: true },
      orderBy: { tier: "asc" },
      select: { id: true },
    }),
    prisma.audience.findFirst({
      where: { companyId, deletedAt: null, active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  ]);

  return prisma.sequence.create({
    data: {
      companyId,
      name: "Default outbound cadence",
      description: "4-touch cold sequence: intro → value bump → LinkedIn → break-up. Every step is drafted for approval.",
      channel: "MULTI",
      active: true,
      isDefault: true,
      offerId: offer?.id ?? null,
      audienceId: audience?.id ?? null,
      steps: { create: DEFAULT_SEQUENCE_STEPS },
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });
}

/**
 * Enroll a single lead into a sequence (the default when none is given). Skips
 * gracefully when there's no active sequence/steps or the lead is already
 * enrolled. Sets nextRunAt from the first step's offset so the autopilot picks
 * it up on the next tick. Returns the enrollment, or null when skipped.
 */
export async function enrollLead(args: {
  companyId: string;
  leadId: string;
  sequenceId?: string | null;
}) {
  const sequence = args.sequenceId
    ? await prisma.sequence.findFirst({
        where: { id: args.sequenceId, companyId: args.companyId, deletedAt: null, active: true },
        include: { steps: { orderBy: { order: "asc" } } },
      })
    : await ensureDefaultSequence(args.companyId);

  if (!sequence || !sequence.active || sequence.steps.length === 0) return null;

  const existing = await prisma.sequenceEnrollment.findUnique({
    where: { sequenceId_leadId: { sequenceId: sequence.id, leadId: args.leadId } },
    select: { id: true },
  });
  if (existing) return null;

  const firstOffset = sequence.steps[0]?.dayOffset ?? 0;
  return prisma.sequenceEnrollment.create({
    data: {
      companyId: args.companyId,
      sequenceId: sequence.id,
      leadId: args.leadId,
      status: "ACTIVE",
      currentStep: 0,
      nextRunAt: new Date(Date.now() + firstOffset * DAY_MS),
    },
  });
}

/**
 * Enroll outbound, still-open leads that aren't in a sequence yet (up to `max`).
 * Used both by the autopilot (sweep stragglers) and the manual "enroll" action.
 */
export async function enrollEligibleLeads(args: {
  companyId: string;
  sequenceId?: string | null;
  max?: number;
}): Promise<{ enrolled: number }> {
  const max = args.max ?? 25;
  const enrolledLeadIds = (
    await prisma.sequenceEnrollment.findMany({
      where: { companyId: args.companyId },
      select: { leadId: true },
    })
  ).map((e) => e.leadId);

  const leads = await prisma.lead.findMany({
    where: {
      companyId: args.companyId,
      deletedAt: null,
      outcome: "OPEN",
      source: { in: [...OUTBOUND_SOURCES] },
      id: { notIn: enrolledLeadIds.length ? enrolledLeadIds : ["__none__"] },
    },
    orderBy: { score: "desc" },
    take: max,
    select: { id: true },
  });

  let enrolled = 0;
  for (const l of leads) {
    const e = await enrollLead({ companyId: args.companyId, leadId: l.id, sequenceId: args.sequenceId });
    if (e) enrolled++;
  }
  return { enrolled };
}

export interface AdvanceResult {
  advanced: number;
  drafted: number;
  completed: number;
}

/**
 * Advance every enrollment whose next step is due: generate that step's message
 * and drop it into the approval queue (human-in-the-loop — nothing is sent),
 * then schedule the following step. Completing the last step finishes the
 * enrollment. Bounded by `max` per run.
 */
export async function advanceDueEnrollments(args: {
  companyId: string;
  now?: Date;
  max?: number;
}): Promise<AdvanceResult> {
  const now = args.now ?? new Date();
  const max = args.max ?? 25;

  const due = await prisma.sequenceEnrollment.findMany({
    where: {
      companyId: args.companyId,
      status: "ACTIVE",
      nextRunAt: { lte: now },
      lead: { deletedAt: null, outcome: "OPEN" },
      sequence: { active: true, deletedAt: null },
    },
    orderBy: { nextRunAt: "asc" },
    take: max,
    include: {
      sequence: { include: { steps: { orderBy: { order: "asc" } }, offer: true } },
      lead: true,
    },
  });

  const company = await prisma.company.findUnique({
    where: { id: args.companyId },
    select: { name: true, industry: true, aiContext: true, currency: true },
  });
  if (!company) return { advanced: 0, drafted: 0, completed: 0 };

  let advanced = 0;
  let drafted = 0;
  let completed = 0;

  for (const enr of due) {
    const steps = enr.sequence.steps;
    const nextOrder = enr.currentStep + 1;
    const step = steps.find((s) => s.order === nextOrder);

    // Nothing left to do → complete.
    if (!step) {
      await prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: { status: "COMPLETED", nextRunAt: null, completedAt: now },
      });
      completed++;
      continue;
    }

    try {
      // Personalisation facts: latest website audit ("loads in 9s, no HTTPS…")
      // and the no-website flag make the message concrete instead of generic.
      const audit = await prisma.websiteAudit.findFirst({
        where: { leadId: enr.leadId, companyId: args.companyId },
        orderBy: { createdAt: "desc" },
      });
      const facts = audit
        ? `Concrete facts from our website audit you should reference naturally: ${auditDraftContext(audit)}.`
        : enr.lead.hasWebsite === false
          ? "Fact: this business has NO website at all (verified via Google Maps) — that is the core pain to address."
          : "";

      const result = await generateContent({
        kind: step.kind,
        channel: step.channel,
        company: {
          name: company.name,
          industry: company.industry,
          aiContext: company.aiContext,
          currency: company.currency,
        },
        lead: {
          name: enr.lead.name,
          companyName: enr.lead.companyName,
          position: enr.lead.position,
          industry: enr.lead.industry,
          source: enr.lead.source,
          priority: enr.lead.priority,
          score: enr.lead.score,
        },
        offer: enr.sequence.offer
          ? {
              name: enr.sequence.offer.name,
              summary: enr.sequence.offer.summary,
              deliverables: enr.sequence.offer.deliverables,
              priceFrom: enr.sequence.offer.priceFrom,
            }
          : undefined,
        userPrompt: `Sequence "${enr.sequence.name}" — step ${step.order}/${steps.length} (${step.name}). ${step.prompt}${facts ? ` ${facts}` : ""}`,
      });

      const message = await prisma.campaignMessage.create({
        data: {
          companyId: args.companyId,
          kind: step.kind,
          body: result.text,
          isAiGenerated: true,
          approved: false,
          leadId: enr.leadId,
          offerId: enr.sequence.offerId ?? null,
        },
      });

      await prisma.approvalRequest.create({
        data: {
          companyId: args.companyId,
          type: "AI_FOLLOWUP",
          status: "PENDING",
          title: `${enr.sequence.name} · step ${step.order} (${step.name}) · ${enr.lead.name}`,
          summary: result.text.slice(0, 140),
          payload: {
            kind: step.kind,
            channel: step.channel,
            body: result.text,
            provider: result.provider,
            fallback: result.fallback,
            sequenceId: enr.sequenceId,
            step: step.order,
          },
          leadId: enr.leadId,
          campaignMessageId: message.id,
        },
      });

      await logActivity({
        companyId: args.companyId,
        leadId: enr.leadId,
        type: "AI_DRAFT",
        title: `Sequence step ${step.order} drafted (${step.name})`,
        meta: { sequenceId: enr.sequenceId, channel: step.channel },
      });

      await logAiDecision({
        companyId: args.companyId,
        actionType: "GENERATE_FOLLOWUP",
        status: result.fallback ? "FALLBACK" : "SUCCESS",
        provider: result.provider,
        model: result.model,
        promptKey: result.promptKey,
        inputSummary: `Sequence ${enr.sequence.name} step ${step.order} for ${enr.lead.name}`,
        output: result.text,
        tokensUsed: result.tokensUsed,
        relatedLeadId: enr.leadId,
      });

      drafted++;

      const following = steps.find((s) => s.order === nextOrder + 1);
      await prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: {
          currentStep: nextOrder,
          lastStepAt: now,
          nextRunAt: following ? new Date(now.getTime() + following.dayOffset * DAY_MS) : null,
          status: following ? "ACTIVE" : "COMPLETED",
          completedAt: following ? null : now,
        },
      });
      advanced++;
      if (!following) completed++;
    } catch (e) {
      console.error("[sequences] advance failed for enrollment", enr.id, e);
      // Back off this enrollment by a day so a single bad step doesn't wedge the run.
      await prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: { nextRunAt: new Date(now.getTime() + DAY_MS) },
      });
    }
  }

  return { advanced, drafted, completed };
}
