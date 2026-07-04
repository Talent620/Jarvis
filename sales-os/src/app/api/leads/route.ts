import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { leadCreateSchema } from "@/lib/validations";
import { recomputeLeadScore } from "@/lib/lead-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    const outcome = searchParams.get("outcome") || undefined;
    const stageId = searchParams.get("stageId") || undefined;
    const source = searchParams.get("source") || undefined;

    const where: Prisma.LeadWhereInput = {
      companyId: a.ctx.companyId,
      deletedAt: null,
      ...(outcome ? { outcome: outcome as never } : {}),
      ...(stageId ? { stageId } : {}),
      ...(source ? { source: source as never } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { companyName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const leads = await prisma.lead.findMany({
      where,
      include: { stage: true },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 200,
    });

    return NextResponse.json(leads);
  } catch (err) {
    return serverError(err, "leads.GET");
  }
}

export async function POST(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, leadCreateSchema);
  if ("res" in b) return b.res;

  try {
    const { email, stageId, ...rest } = b.data;

    // Default to the first pipeline stage when none provided.
    const stage =
      stageId ??
      (
        await prisma.funnelStage.findFirst({
          where: { companyId: a.ctx.companyId },
          orderBy: { order: "asc" },
          select: { id: true },
        })
      )?.id;

    const created = await prisma.lead.create({
      data: {
        ...rest,
        email: email || null,
        companyId: a.ctx.companyId,
        ownerId: a.ctx.userId,
        stageId: stage ?? null,
      },
    });

    await prisma.leadActivity.create({
      data: {
        companyId: a.ctx.companyId,
        leadId: created.id,
        userId: a.ctx.userId,
        type: "SYSTEM",
        title: "Lead created",
        body: `Source: ${created.source}`,
      },
    });

    const score = await recomputeLeadScore(created);

    return NextResponse.json({ ...created, score: score.score, scoreGrade: score.grade }, { status: 201 });
  } catch (err) {
    return serverError(err, "leads.POST");
  }
}
