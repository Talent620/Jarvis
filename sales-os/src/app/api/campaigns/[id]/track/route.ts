import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { campaignTrackSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

/** Record a reply or conversion against a campaign (updates the funnel counters). */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, campaignTrackSchema);
  if ("res" in b) return b.res;

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      select: { id: true, sentCount: true, repliedCount: true, convertedCount: true },
    });
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Keep counters sane: replies/conversions can't exceed what was sent.
    if (b.data.event === "reply") {
      if (campaign.repliedCount >= campaign.sentCount) {
        return NextResponse.json({ campaign, capped: true });
      }
      const updated = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { repliedCount: { increment: 1 } },
      });
      return NextResponse.json({ campaign: updated });
    }

    // conversion
    if (campaign.convertedCount >= campaign.sentCount) {
      return NextResponse.json({ campaign, capped: true });
    }
    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { convertedCount: { increment: 1 } },
    });
    return NextResponse.json({ campaign: updated });
  } catch (err) {
    return serverError(err, "campaign.track");
  }
}
