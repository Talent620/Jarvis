import type { ContentKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateContent, logAiDecision } from "@/lib/ai";
import { logActivity } from "@/lib/activity";
import { sendDraftToLead } from "@/lib/email/outreach";

export interface OutreachResult {
  leadId: string;
  campaignMessageId: string;
  drafted: boolean;
  sent: boolean;
  provider?: string;
  simulated?: boolean;
  body: string;
  skipped?: string;
  error?: string;
}

/**
 * Generate an AI first-touch email draft for an existing lead and file it into
 * the approval queue (same shape as the acquisition auto-draft path). Returns
 * the new CampaignMessage + ApprovalRequest ids. Never sends — see send below.
 */
export async function generateDraftForLead(args: {
  companyId: string;
  leadId: string;
  context?: string | null;
}): Promise<{ campaignMessageId: string; approvalId: string; body: string }> {
  const lead = await prisma.lead.findFirst({
    where: { id: args.leadId, companyId: args.companyId, deletedAt: null },
    select: {
      id: true, name: true, companyName: true, position: true, industry: true,
      source: true, priority: true, score: true,
    },
  });
  if (!lead) throw new Error("lead not found");

  const company = await prisma.company.findUnique({
    where: { id: args.companyId },
    select: { name: true, industry: true, aiContext: true, currency: true },
  });
  if (!company) throw new Error("company not found");

  const kind: ContentKind = "EMAIL";
  const result = await generateContent({
    kind,
    company: {
      name: company.name,
      industry: company.industry,
      aiContext: company.aiContext,
      currency: company.currency,
    },
    lead: {
      name: lead.name,
      companyName: lead.companyName,
      position: lead.position,
      industry: lead.industry,
      source: lead.source,
      priority: lead.priority,
      score: lead.score,
    },
    userPrompt:
      `First-touch outreach drafted on request from JARVIS.${args.context ? ` Context — ${args.context}.` : ""}` +
      " Write a short, specific, non-pushy message that earns a reply: open with genuine relevance," +
      " make one clear value point tied to their context, end with a soft ask. No false familiarity, respect GDPR.",
  });

  const message = await prisma.campaignMessage.create({
    data: { companyId: args.companyId, kind, body: result.text, isAiGenerated: true, approved: false, leadId: lead.id },
  });

  const approval = await prisma.approvalRequest.create({
    data: {
      companyId: args.companyId,
      type: "AI_MESSAGE",
      status: "PENDING",
      title: `First-touch outreach · ${lead.name}`,
      summary: result.text.slice(0, 140),
      payload: { kind, body: result.text, provider: result.provider, fallback: result.fallback },
      leadId: lead.id,
      campaignMessageId: message.id,
    },
  });

  await logActivity({ companyId: args.companyId, leadId: lead.id, type: "AI_DRAFT", title: "AI drafted outreach (JARVIS)" });
  await logAiDecision({
    companyId: args.companyId,
    actionType: "GENERATE_MESSAGE",
    status: result.fallback ? "FALLBACK" : "SUCCESS",
    provider: result.provider,
    model: result.model,
    promptKey: result.promptKey,
    inputSummary: `JARVIS outreach for ${lead.name}`,
    output: result.text,
    tokensUsed: result.tokensUsed,
    relatedLeadId: lead.id,
  });

  return { campaignMessageId: message.id, approvalId: approval.id, body: result.text };
}

/**
 * Find the newest unsent, pending email draft for a lead — so a repeat request
 * reuses the existing draft instead of stacking duplicates.
 */
async function findPendingDraft(companyId: string, leadId: string) {
  const msg = await prisma.campaignMessage.findFirst({
    where: { companyId, leadId, sentAt: null, kind: { in: ["EMAIL", "FOLLOW_UP"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, body: true },
  });
  if (!msg) return null;
  const approval = await prisma.approvalRequest.findFirst({
    where: { companyId, campaignMessageId: msg.id, status: "PENDING" },
    select: { id: true },
  });
  return { campaignMessageId: msg.id, approvalId: approval?.id ?? null, body: msg.body };
}

/**
 * Draft (if needed) and optionally send an outreach email for a lead — the
 * "JARVIS creates a mail there and it auto-sends" path. Reuses an existing
 * pending draft when present; marks the approval EXECUTED after a successful send.
 */
export async function draftAndSendForLead(args: {
  companyId: string;
  leadId: string;
  send?: boolean;
  context?: string | null;
}): Promise<OutreachResult> {
  let draft = await findPendingDraft(args.companyId, args.leadId);
  let drafted = false;
  if (!draft) {
    const g = await generateDraftForLead({ companyId: args.companyId, leadId: args.leadId, context: args.context });
    draft = { campaignMessageId: g.campaignMessageId, approvalId: g.approvalId, body: g.body };
    drafted = true;
  }

  if (args.send === false) {
    return { leadId: args.leadId, campaignMessageId: draft.campaignMessageId, drafted, sent: false, body: draft.body };
  }

  const sendRes = await sendDraftToLead({
    companyId: args.companyId,
    campaignMessageId: draft.campaignMessageId,
    auto: true,
  });

  if (sendRes.ok && !sendRes.skipped && draft.approvalId) {
    await prisma.approvalRequest.update({
      where: { id: draft.approvalId },
      data: {
        status: "EXECUTED",
        decidedAt: new Date(),
        decisionNote: `Auto-sent via ${sendRes.provider}${sendRes.simulated ? " (simulated)" : ""} (JARVIS)`,
      },
    });
  }

  return {
    leadId: args.leadId,
    campaignMessageId: draft.campaignMessageId,
    drafted,
    sent: sendRes.ok && !sendRes.skipped,
    provider: sendRes.provider,
    simulated: sendRes.simulated,
    body: draft.body,
    skipped: sendRes.skipped,
    error: sendRes.error,
  };
}
