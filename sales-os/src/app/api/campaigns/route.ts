import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { campaignCreateSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const campaigns = await prisma.campaign.findMany({
      where: { companyId: a.ctx.companyId, deletedAt: null },
      include: {
        audience: { select: { name: true } },
        offer: { select: { name: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(campaigns);
  } catch (err) {
    return serverError(err, "campaigns.GET");
  }
}

export async function POST(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, campaignCreateSchema);
  if ("res" in b) return b.res;

  try {
    const campaign = await prisma.campaign.create({
      data: { companyId: a.ctx.companyId, ...b.data },
    });
    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    return serverError(err, "campaigns.POST");
  }
}
