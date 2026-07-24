import { NextResponse } from "next/server";
import type { CampaignStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuth, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const RECIPIENT_CAP = 500;

/**
 * Simulated dispatch: a campaign "send" records outreach against the matching
 * open leads — it logs a MESSAGE_SENT activity per recipient, stamps approved
 * messages as sent, updates counters, and notifies the team. No external email
 * is sent unless a real channel integration is wired up (kept honest + safe).
 */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      include: { audience: { select: { industry: true, region: true } } },
    });
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (campaign.status === "COMPLETED" || campaign.status === "ARCHIVED") {
      return NextResponse.json(
        { error: "This campaign is closed and can't be sent." },
        { status: 409 },
      );
    }

    // Target the matching open leads (narrowed by the audience when one is set).
    const recipients = await prisma.lead.findMany({
      where: {
        companyId: a.ctx.companyId,
        deletedAt: null,
        outcome: "OPEN",
        ...(campaign.audience?.industry ? { industry: campaign.audience.industry } : {}),
        ...(campaign.audience?.region ? { region: campaign.audience.region } : {}),
      },
      select: { id: true },
      take: RECIPIENT_CAP,
    });
    const ids = recipients.map((r) => r.id);

    const now = new Date();
    const nextStatus: CampaignStatus =
      campaign.status === "DRAFT" || campaign.status === "PAUSED"
        ? "ACTIVE"
        : campaign.status;

    await prisma.$transaction([
      prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          sentCount: { increment: ids.length },
          status: nextStatus,
          startAt: campaign.startAt ?? now,
        },
      }),
      prisma.campaignMessage.updateMany({
        where: { campaignId: campaign.id, approved: true, sentAt: null },
        data: { sentAt: now },
      }),
      prisma.leadActivity.createMany({
        data: ids.map((leadId) => ({
          companyId: a.ctx.companyId,
          leadId,
          userId: a.ctx.userId,
          type: "MESSAGE_SENT" as const,
          title: `Campaign "${campaign.name}" sent`,
        })),
      }),
      prisma.lead.updateMany({
        where: { id: { in: ids } },
        data: { lastContactedAt: now },
      }),
      prisma.notification.create({
        data: {
          companyId: a.ctx.companyId,
          userId: a.ctx.userId,
          type: "SYSTEM",
          title: "Campaign sent",
          body: `"${campaign.name}" reached ${ids.length} lead${ids.length === 1 ? "" : "s"}.`,
          link: `/campaigns/${campaign.id}`,
        },
      }),
    ]);

    return NextResponse.json({ recipients: ids.length, status: nextStatus });
  } catch (err) {
    return serverError(err, "campaign.send");
  }
}
