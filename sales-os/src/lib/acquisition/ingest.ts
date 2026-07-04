import type { ContentKind, LeadSource, Priority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recomputeLeadScore } from "@/lib/lead-service";
import { logActivity, notify } from "@/lib/activity";
import { generateContent, logAiDecision } from "@/lib/ai";
import { HOT_LEAD_THRESHOLD, LEAD_SOURCE_LABELS } from "@/lib/constants";

/** Sources treated as cold/outbound — drives outreach-style first-touch drafts. */
const OUTBOUND_SOURCES = new Set<LeadSource>([
  "COLD_OUTREACH",
  "LINKEDIN",
  "MARKETPLACE",
  "FACEBOOK_GROUP",
]);

export interface NormalizedLeadInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  position?: string | null;
  website?: string | null;
  industry?: string | null;
  region?: string | null;
  budget?: number | null;
  estimatedValue?: number | null;
  message?: string | null;
  sourceDetail?: string | null;
}

export interface IngestResult {
  leadId: string;
  deduped: boolean;
  score: number;
  grade: string;
  name: string;
}

function cleanName(input: NormalizedLeadInput): string {
  const n = input.name?.trim();
  if (n) return n;
  if (input.email) return input.email.split("@")[0];
  if (input.companyName) return input.companyName.trim();
  return "New lead";
}

/**
 * Single entry point for every automatically-acquired lead (public form,
 * webhook, or outbound discovery). Deduplicates within the company, creates +
 * scores + assigns the lead, writes the timeline, and optionally has AI draft a
 * first follow-up into the approval queue. Never sends anything itself.
 */
export async function ingestLead(args: {
  companyId: string;
  input: NormalizedLeadInput;
  source: LeadSource;
  sourceDetail?: string | null;
  tags?: string[];
  ownerId?: string | null;
  priority?: Priority | null;
  /** Extra context line woven into an outbound first-touch draft. */
  draftContext?: string | null;
  autoDraft?: boolean;
  /** Skip the per-lead notification (used for bulk discovery). */
  silent?: boolean;
}): Promise<IngestResult> {
  const { companyId, input, source } = args;
  const sourceLabel = LEAD_SOURCE_LABELS[source] ?? "Inbound";
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;

  // --- Dedupe against existing (non-deleted) leads ---
  const existing = await prisma.lead.findFirst({
    where: {
      companyId,
      deletedAt: null,
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : []),
      ],
    },
    select: { id: true, name: true, score: true, scoreGrade: true },
  });

  if (existing && (email || phone)) {
    await Promise.all([
      prisma.lead.update({
        where: { id: existing.id },
        data: { lastContactedAt: new Date() },
      }),
      logActivity({
        companyId,
        leadId: existing.id,
        type: "SYSTEM",
        title: `Re-engaged via ${sourceLabel}`,
        body: input.message ?? null,
      }),
    ]);
    return {
      leadId: existing.id,
      deduped: true,
      score: existing.score,
      grade: existing.scoreGrade,
      name: existing.name,
    };
  }

  // --- Assign an owner (first member of the workspace) ---
  const owner =
    args.ownerId ??
    (
      await prisma.user.findFirst({
        where: { companyId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
    )?.id ??
    null;

  const name = cleanName(input);

  const created = await prisma.lead.create({
    data: {
      companyId,
      name,
      email,
      phone,
      companyName: input.companyName?.trim() || null,
      position: input.position?.trim() || null,
      website: input.website?.trim() || null,
      industry: input.industry?.trim() || null,
      region: input.region?.trim() || null,
      budget: input.budget ?? null,
      estimatedValue: input.estimatedValue ?? null,
      source,
      sourceDetail: args.sourceDetail ?? input.sourceDetail ?? null,
      outcome: "OPEN",
      priority: args.priority ?? undefined,
      ownerId: owner,
      tags: args.tags ?? [],
      nextActionAt: new Date(),
      nextActionNote: "Respond to new lead",
    },
  });

  const score = await recomputeLeadScore(created);

  await logActivity({
    companyId,
    leadId: created.id,
    type: "SYSTEM",
    title: `Captured via ${sourceLabel}`,
    body: input.message ?? null,
    meta: { source, sourceDetail: args.sourceDetail ?? input.sourceDetail ?? null },
  });

  if (!args.silent) {
    const hot = score.score >= HOT_LEAD_THRESHOLD;
    await notify({
      companyId,
      type: hot ? "HOT_LEAD" : "SYSTEM",
      title: hot ? `New hot lead: ${name}` : `New lead: ${name}`,
      body: `Captured via ${sourceLabel}${input.companyName ? ` · ${input.companyName}` : ""} · score ${score.score} (${score.grade})`,
      link: `/leads/${created.id}`,
    });
  }

  // --- Optional AI first-touch draft → approvals queue ---
  if (args.autoDraft) {
    try {
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, industry: true, aiContext: true, currency: true },
      });
      if (company) {
        const isOutbound = OUTBOUND_SOURCES.has(source);
        const kind: ContentKind = isOutbound ? "EMAIL" : "FOLLOW_UP";
        const result = await generateContent({
          kind,
          company: {
            name: company.name,
            industry: company.industry,
            aiContext: company.aiContext,
            currency: company.currency,
          },
          lead: {
            name,
            companyName: input.companyName ?? null,
            position: input.position ?? null,
            industry: input.industry ?? null,
            source,
            priority: args.priority ?? "MEDIUM",
            score: score.score,
          },
          userPrompt: isOutbound
            ? `Cold outbound prospect sourced for our ICP.${args.draftContext ? ` Context — ${args.draftContext}.` : ""} Write a short, specific, non-pushy first-touch message that earns a reply: open with genuine relevance, make one clear value point tied to their context, and end with a soft ask. No false familiarity, no spam, respect GDPR.`
            : input.message
              ? `The lead said: "${input.message}". Write a warm, prompt first reply.`
              : "Write a warm, prompt first-touch reply to this new inbound lead.",
        });

        const message = await prisma.campaignMessage.create({
          data: {
            companyId,
            kind,
            body: result.text,
            isAiGenerated: true,
            approved: false,
            leadId: created.id,
          },
        });

        await prisma.approvalRequest.create({
          data: {
            companyId,
            type: isOutbound ? "AI_MESSAGE" : "AI_FOLLOWUP",
            status: "PENDING",
            title: isOutbound ? `First-touch outreach · ${name}` : `First-touch reply · ${name}`,
            summary: result.text.slice(0, 140),
            payload: {
              kind,
              body: result.text,
              provider: result.provider,
              fallback: result.fallback,
            },
            leadId: created.id,
            campaignMessageId: message.id,
          },
        });

        await logActivity({
          companyId,
          leadId: created.id,
          type: "AI_DRAFT",
          title: "AI drafted a first-touch reply",
        });

        await logAiDecision({
          companyId,
          actionType: "GENERATE_FOLLOWUP",
          status: result.fallback ? "FALLBACK" : "SUCCESS",
          provider: result.provider,
          model: result.model,
          promptKey: result.promptKey,
          inputSummary: `Auto first-touch for ${name} (${sourceLabel})`,
          output: result.text,
          tokensUsed: result.tokensUsed,
          relatedLeadId: created.id,
        });
      }
    } catch (e) {
      console.error("[acquisition] auto-draft failed:", e);
    }
  }

  return {
    leadId: created.id,
    deduped: false,
    score: score.score,
    grade: score.grade,
    name,
  };
}
