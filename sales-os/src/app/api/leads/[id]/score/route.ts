import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, serverError } from "@/lib/api";
import { recomputeLeadScore } from "@/lib/lead-service";
import { logAiDecision } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const lead = await prisma.lead.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
    });
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const result = await recomputeLeadScore(lead);

    await logAiDecision({
      companyId: a.ctx.companyId,
      userId: a.ctx.userId,
      actionType: "SCORE_LEAD",
      status: "SUCCESS",
      provider: "rules",
      promptKey: "scoring.rule_based",
      inputSummary: `Rescored lead ${lead.name}`,
      output: `${result.score} (${result.grade}) — ${result.reason}`,
      relatedLeadId: lead.id,
    });

    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "lead.score");
  }
}
