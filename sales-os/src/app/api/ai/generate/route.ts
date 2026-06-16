import { NextResponse } from "next/server";
import type { AiActionType, ApprovalType, ContentKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { aiGenerateSchema } from "@/lib/validations";
import { generateContent, logAiDecision } from "@/lib/ai";
import { CONTENT_KIND_LABELS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const APPROVAL_TYPE: Record<ContentKind, ApprovalType> = {
  AD: "AI_AD",
  FOLLOW_UP: "AI_FOLLOWUP",
  EMAIL: "AI_MESSAGE",
  DM: "AI_MESSAGE",
  POST: "AI_MESSAGE",
  OFFER: "AI_MESSAGE",
  SUBJECT_LINE: "AI_MESSAGE",
  COLD_CALL_SCRIPT: "AI_MESSAGE",
};

const ACTION_TYPE: Record<ContentKind, AiActionType> = {
  AD: "GENERATE_AD",
  FOLLOW_UP: "GENERATE_FOLLOWUP",
  EMAIL: "GENERATE_MESSAGE",
  DM: "GENERATE_MESSAGE",
  POST: "GENERATE_MESSAGE",
  OFFER: "GENERATE_MESSAGE",
  SUBJECT_LINE: "GENERATE_MESSAGE",
  COLD_CALL_SCRIPT: "GENERATE_MESSAGE",
};

/** Pull a leading "Subject: ..." line out of an email draft, if present. */
function splitSubject(kind: ContentKind, text: string): { subject?: string; body: string } {
  if (kind !== "EMAIL") return { body: text };
  const match = text.match(/^\s*subject:\s*(.+)\n+([\s\S]*)$/i);
  if (match) return { subject: match[1].trim(), body: match[2].trim() };
  return { body: text };
}

export async function POST(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, aiGenerateSchema);
  if ("res" in b) return b.res;

  try {
    const company = await prisma.company.findUnique({
      where: { id: a.ctx.companyId },
      select: { name: true, industry: true, aiContext: true, currency: true },
    });
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    const [lead, offer] = await Promise.all([
      b.data.leadId
        ? prisma.lead.findFirst({
            where: { id: b.data.leadId, companyId: a.ctx.companyId, deletedAt: null },
            include: { stage: { select: { name: true } } },
          })
        : null,
      b.data.offerId
        ? prisma.offer.findFirst({ where: { id: b.data.offerId, companyId: a.ctx.companyId } })
        : null,
    ]);

    const result = await generateContent({
      kind: b.data.kind,
      tone: b.data.tone,
      channel: b.data.channel,
      userPrompt: b.data.prompt,
      company: {
        name: company.name,
        industry: company.industry,
        aiContext: company.aiContext,
        currency: company.currency,
      },
      lead: lead
        ? {
            name: lead.name,
            companyName: lead.companyName,
            position: lead.position,
            industry: lead.industry,
            source: lead.source,
            priority: lead.priority,
            score: lead.score,
            stage: lead.stage?.name,
          }
        : undefined,
      offer: offer
        ? {
            name: offer.name,
            summary: offer.summary,
            deliverables: offer.deliverables,
            priceFrom: offer.priceFrom,
          }
        : undefined,
    });

    const { subject, body } = splitSubject(b.data.kind, result.text);

    const message = await prisma.campaignMessage.create({
      data: {
        companyId: a.ctx.companyId,
        kind: b.data.kind,
        subject,
        body,
        isAiGenerated: true,
        approved: false,
        leadId: lead?.id,
        offerId: offer?.id,
      },
    });

    await logAiDecision({
      companyId: a.ctx.companyId,
      userId: a.ctx.userId,
      actionType: ACTION_TYPE[b.data.kind],
      status: result.fallback ? "FALLBACK" : "SUCCESS",
      provider: result.provider,
      model: result.model,
      promptKey: result.promptKey,
      inputSummary: `${CONTENT_KIND_LABELS[b.data.kind]}${lead ? ` for ${lead.name}` : ""}`,
      output: result.text,
      tokensUsed: result.tokensUsed,
      relatedLeadId: lead?.id,
    });

    if (lead) {
      await prisma.leadActivity.create({
        data: {
          companyId: a.ctx.companyId,
          leadId: lead.id,
          userId: a.ctx.userId,
          type: "AI_DRAFT",
          title: `AI drafted a ${CONTENT_KIND_LABELS[b.data.kind].toLowerCase()}`,
        },
      });
    }

    let approvalId: string | null = null;
    if (b.data.createApproval) {
      const approval = await prisma.approvalRequest.create({
        data: {
          companyId: a.ctx.companyId,
          type: APPROVAL_TYPE[b.data.kind],
          status: "PENDING",
          title: `${CONTENT_KIND_LABELS[b.data.kind]}${lead ? ` · ${lead.name}` : ""}`,
          summary: subject ?? body.slice(0, 140),
          payload: {
            kind: b.data.kind,
            subject: subject ?? null,
            body,
            tone: b.data.tone ?? null,
            channel: b.data.channel ?? null,
            provider: result.provider,
            fallback: result.fallback,
          },
          leadId: lead?.id,
          campaignMessageId: message.id,
          requestedById: a.ctx.userId,
        },
      });
      approvalId = approval.id;

      await prisma.notification.create({
        data: {
          companyId: a.ctx.companyId,
          userId: a.ctx.userId,
          type: "APPROVAL_PENDING",
          title: "New AI draft awaiting approval",
          body: approval.title,
          link: "/approvals",
        },
      });
    }

    return NextResponse.json({
      content: result.text,
      subject,
      body,
      provider: result.provider,
      fallback: result.fallback,
      messageId: message.id,
      approvalId,
    });
  } catch (err) {
    return serverError(err, "ai.generate");
  }
}
