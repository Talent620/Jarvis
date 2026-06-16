import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { campaignUpdateSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      include: {
        audience: { select: { id: true, name: true, industry: true, region: true } },
        offer: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: "desc" } },
        _count: { select: { messages: true } },
      },
    });
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(campaign);
  } catch (err) {
    return serverError(err, "campaign.GET");
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, campaignUpdateSchema);
  if ("res" in b) return b.res;

  try {
    const existing = await prisma.campaign.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Keep lifecycle timestamps coherent with status transitions.
    const now = new Date();
    const lifecycle: { startAt?: Date; endAt?: Date | null } = {};
    if (b.data.status === "ACTIVE" && !existing.startAt) lifecycle.startAt = now;
    if (b.data.status === "COMPLETED" && !existing.endAt) lifecycle.endAt = now;

    const updated = await prisma.campaign.update({
      where: { id: params.id },
      data: { ...b.data, ...lifecycle },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return serverError(err, "campaign.PATCH");
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const existing = await prisma.campaign.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.campaign.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "campaign.DELETE");
  }
}
