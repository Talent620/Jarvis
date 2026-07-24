import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { CampaignDetailClient } from "@/components/campaigns/campaign-detail-client";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  const { companyId } = a.ctx;

  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, companyId, deletedAt: null },
    include: {
      audience: { select: { name: true, industry: true, region: true } },
      offer: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!campaign) notFound();

  const [offers, recipientEstimate] = await Promise.all([
    prisma.offer.findMany({
      where: { companyId, active: true },
      orderBy: { tier: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lead.count({
      where: {
        companyId,
        deletedAt: null,
        outcome: "OPEN",
        ...(campaign.audience?.industry ? { industry: campaign.audience.industry } : {}),
        ...(campaign.audience?.region ? { region: campaign.audience.region } : {}),
      },
    }),
  ]);

  return (
    <CampaignDetailClient
      campaign={{
        id: campaign.id,
        name: campaign.name,
        goal: campaign.goal,
        channel: campaign.channel,
        status: campaign.status,
        sentCount: campaign.sentCount,
        repliedCount: campaign.repliedCount,
        convertedCount: campaign.convertedCount,
        startAt: campaign.startAt ? campaign.startAt.toISOString() : null,
        endAt: campaign.endAt ? campaign.endAt.toISOString() : null,
        audience: campaign.audience ? { name: campaign.audience.name } : null,
        offer: campaign.offer ? { name: campaign.offer.name } : null,
        messages: campaign.messages.map((m) => ({
          id: m.id,
          kind: m.kind,
          subject: m.subject,
          body: m.body,
          isAiGenerated: m.isAiGenerated,
          approved: m.approved,
          sentAt: m.sentAt ? m.sentAt.toISOString() : null,
          createdAt: m.createdAt.toISOString(),
        })),
      }}
      offers={offers}
      recipientEstimate={recipientEstimate}
    />
  );
}
