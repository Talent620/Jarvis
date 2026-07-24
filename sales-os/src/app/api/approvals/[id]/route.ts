import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { approvalDecisionSchema } from "@/lib/validations";
import { sendDraftToLead, type SendDraftResult } from "@/lib/email/outreach";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, approvalDecisionSchema);
  if ("res" in b) return b.res;

  try {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId },
    });
    if (!approval) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (approval.status !== "PENDING") {
      return NextResponse.json({ error: "Already decided" }, { status: 409 });
    }

    if (b.data.status === "REJECTED") {
      const rejected = await prisma.approvalRequest.update({
        where: { id: params.id },
        data: {
          status: "REJECTED",
          decisionNote: b.data.decisionNote,
          decidedAt: new Date(),
          decidedById: a.ctx.userId,
        },
      });
      return NextResponse.json(rejected);
    }

    // APPROVED → perform the side effects, then mark EXECUTED.
    const payload = (approval.payload ?? {}) as Record<string, unknown>;
    const kind = typeof payload.kind === "string" ? payload.kind : "message";

    // Email-kind drafts are delivered for real on approval (Resend/Mailgun
    // when configured, clearly-simulated send otherwise). Other kinds (DMs,
    // call scripts…) still become a manual task.
    let sendResult: SendDraftResult | null = null;
    if (approval.campaignMessageId && (kind === "EMAIL" || kind === "FOLLOW_UP")) {
      sendResult = await sendDraftToLead({
        companyId: a.ctx.companyId,
        campaignMessageId: approval.campaignMessageId,
        userId: a.ctx.userId,
      });
    }
    const delivered = sendResult?.ok === true && !sendResult.skipped;

    await prisma.$transaction(async (tx) => {
      if (approval.campaignMessageId) {
        await tx.campaignMessage.update({
          where: { id: approval.campaignMessageId },
          data: { approved: true },
        });
      }

      // Not delivered automatically → turn the approved draft into a task.
      if (approval.leadId && !delivered) {
        await tx.task.create({
          data: {
            companyId: a.ctx.companyId,
            leadId: approval.leadId,
            assigneeId: a.ctx.userId,
            title: `Send approved ${kind.toLowerCase()}`,
            description: typeof payload.body === "string" ? payload.body.slice(0, 1000) : undefined,
            priority: "HIGH",
            source: "AI",
            dueDate: new Date(Date.now() + 2 * 86_400_000),
          },
        });
      }
      if (approval.leadId) {
        await tx.leadActivity.create({
          data: {
            companyId: a.ctx.companyId,
            leadId: approval.leadId,
            userId: a.ctx.userId,
            type: "MESSAGE_SENT",
            title: delivered
              ? `AI draft approved · emailed via ${sendResult!.provider}${sendResult!.simulated ? " (simulated)" : ""}`
              : "AI draft approved",
            body: approval.title,
          },
        });
      }

      await tx.approvalRequest.update({
        where: { id: params.id },
        data: {
          status: "EXECUTED",
          decisionNote:
            b.data.decisionNote ??
            (delivered
              ? `Sent via ${sendResult!.provider}${sendResult!.simulated ? " (simulated)" : ""}`
              : sendResult?.error
                ? `Send failed: ${sendResult.error.slice(0, 200)} — task created`
                : undefined),
          decidedAt: new Date(),
          decidedById: a.ctx.userId,
        },
      });
    });

    const fresh = await prisma.approvalRequest.findUnique({ where: { id: params.id } });
    return NextResponse.json(fresh);
  } catch (err) {
    return serverError(err, "approval.PATCH");
  }
}
