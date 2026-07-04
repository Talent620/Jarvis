import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { stageUpdateSchema } from "@/lib/validations";
import { recomputeLeadScore } from "@/lib/lead-service";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, stageUpdateSchema);
  if ("res" in b) return b.res;

  try {
    const [lead, stage] = await Promise.all([
      prisma.lead.findFirst({
        where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
        include: { stage: true },
      }),
      prisma.funnelStage.findFirst({
        where: { id: b.data.stageId, companyId: a.ctx.companyId },
      }),
    ]);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 404 });

    // Derive outcome from the destination stage.
    const outcome = stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN";

    const updated = await prisma.lead.update({
      where: { id: params.id },
      data: {
        stageId: stage.id,
        outcome,
        ...(stage.isWon || stage.isLost ? {} : { lastContactedAt: new Date() }),
      },
    });

    await prisma.leadActivity.create({
      data: {
        companyId: a.ctx.companyId,
        leadId: params.id,
        userId: a.ctx.userId,
        type: "STAGE_CHANGE",
        title: `Moved to ${stage.name}`,
        body: lead.stage ? `From ${lead.stage.name}` : undefined,
        meta: { from: lead.stage?.name ?? null, to: stage.name },
      },
    });

    const score = await recomputeLeadScore(updated);
    return NextResponse.json({ ...updated, score: score.score, scoreGrade: score.grade });
  } catch (err) {
    return serverError(err, "lead.stage.PATCH");
  }
}
