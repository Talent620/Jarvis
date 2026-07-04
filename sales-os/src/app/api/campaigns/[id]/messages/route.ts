import { NextResponse } from "next/server";
import type { AiActionType, ApprovalType, ContentKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { campaignMessageCreateSchema } from "@/lib/validations";
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

function splitSubject(kind: ContentKind, text: string): { subject?: string; body: string } {
  if (kind !== "EMAIL") return { body: text };
  const match = text.match(/^\s*subject:\s*(.+)\n+([\s\S]*)$/i);
  if (match) return { subject: match[1].trim(), body: match[2].trim() };
  return { body: text };
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, campaignMessageCreateSchema);
  if ("res" in b) return b.res;

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      include: { offer: true },
    });
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Zod applies the EMAIL default at runtime; the .refine() wrapper widens the
    // inferred type to optional, so re-narrow it here.
    const kind: ContentKind = b.data.kind ?? "EMAIL";

    // --- Manual message ---
    if (!b.data.generate) {
      const message = await prisma.campaignMessage.create({
        data: {
          companyId: a.ctx.companyId,
          campaignId: campaign.id,
          kind: kind,
          subject: b.data.subject,
          body: b.data.body!.trim(),
          isAiGenerated: false,
          approved: true,
          offerId: campaign.offerId ?? undefined,
        },
      });
      return NextResponse.json(message, { status: 201 });
    }

    // --- AI-generated message ---
    const company = await prisma.company.findUnique({
      where: { id: a.ctx.companyId },
      select: { name: true, industry: true, aiContext: true, currency: true },
    });
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    const offer = b.data.offerId
      ? await prisma.offer.findFirst({
          where: { id: b.data.offerId, companyId: a.ctx.companyId },
        })
      : campaign.offer;

    const result = await generateContent({
      kind: kind,
      tone: b.data.tone,
      channel: campaign.channel,
      userPrompt: b.data.prompt ?? campaign.goal ?? undefined,
      company: {
        name: company.name,
        industry: company.industry,
        aiContext: company.aiContext,
        currency: company.currency,
      },
      offer: offer
        ? {
            name: offer.name,
            summary: offer.summary,
            deliverables: offer.deliverables,
            priceFrom: offer.priceFrom,
          }
        : undefined,
    });

    const { subject, body } = splitSubject(kind, result.text);

    const message = await prisma.campaignMessage.create({
      data: {
        companyId: a.ctx.companyId,
        campaignId: campaign.id,
        kind: kind,
        subject,
        body,
        isAiGenerated: true,
        approved: !b.data.createApproval,
        offerId: offer?.id,
      },
    });

    await logAiDecision({
      companyId: a.ctx.companyId,
      userId: a.ctx.userId,
      actionType: ACTION_TYPE[kind],
      status: result.fallback ? "FALLBACK" : "SUCCESS",
      provider: result.provider,
      model: result.model,
      promptKey: result.promptKey,
      inputSummary: `${CONTENT_KIND_LABELS[kind]} for campaign "${campaign.name}"`,
      output: result.text,
      tokensUsed: result.tokensUsed,
    });

    let approvalId: string | null = null;
    if (b.data.createApproval) {
      const approval = await prisma.approvalRequest.create({
        data: {
          companyId: a.ctx.companyId,
          type: APPROVAL_TYPE[kind],
          status: "PENDING",
          title: `${CONTENT_KIND_LABELS[kind]} · ${campaign.name}`,
          summary: subject ?? body.slice(0, 140),
          payload: {
            kind: kind,
            subject: subject ?? null,
            body,
            channel: campaign.channel,
            provider: result.provider,
            fallback: result.fallback,
          },
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

    return NextResponse.json(
      {
        ...message,
        provider: result.provider,
        fallback: result.fallback,
        approvalId,
      },
      { status: 201 },
    );
  } catch (err) {
    return serverError(err, "campaign.messages.POST");
  }
}
