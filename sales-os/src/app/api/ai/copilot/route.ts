import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { copilotSchema } from "@/lib/validations";
import { copilotReply, logAiDecision } from "@/lib/ai";
import { copilotActions } from "@/lib/ai/actions";
import { computeSnapshot } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, copilotSchema);
  if ("res" in b) return b.res;

  try {
    const [company, snapshot] = await Promise.all([
      prisma.company.findUnique({
        where: { id: a.ctx.companyId },
        select: { name: true, industry: true, aiContext: true, currency: true },
      }),
      computeSnapshot(a.ctx.companyId),
    ]);

    const result = await copilotReply({
      message: b.data.message,
      history: b.data.history ?? [],
      company: {
        name: company?.name ?? "Workspace",
        industry: company?.industry,
        aiContext: company?.aiContext,
        currency: company?.currency,
      },
      snapshot,
    });

    await logAiDecision({
      companyId: a.ctx.companyId,
      userId: a.ctx.userId,
      actionType: "COPILOT_QUERY",
      status: result.fallback ? "FALLBACK" : "SUCCESS",
      provider: result.provider,
      model: result.model,
      promptKey: "copilot.query",
      inputSummary: b.data.message.slice(0, 200),
      output: result.text,
      tokensUsed: result.tokensUsed,
    });

    const actions = await copilotActions(a.ctx.companyId, snapshot);

    return NextResponse.json({
      reply: result.text,
      provider: result.provider,
      fallback: result.fallback,
      actions,
    });
  } catch (err) {
    return serverError(err, "ai.copilot");
  }
}
