import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, serverError } from "@/lib/api";
import { computeSnapshot, funnelDistribution, sourceDistribution } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const [snapshot, funnel, sources, series] = await Promise.all([
      computeSnapshot(a.ctx.companyId),
      funnelDistribution(a.ctx.companyId),
      sourceDistribution(a.ctx.companyId),
      prisma.metricSnapshot.findMany({
        where: { companyId: a.ctx.companyId },
        orderBy: { date: "asc" },
        take: 400,
      }),
    ]);

    return NextResponse.json({ snapshot, funnel, sources, series });
  } catch (err) {
    return serverError(err, "metrics.GET");
  }
}
