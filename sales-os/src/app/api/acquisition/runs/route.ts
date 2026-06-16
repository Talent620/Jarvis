import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await getAuth();
  if ("res" in a) return a.res;
  try {
    const runs = await prisma.acquisitionRun.findMany({
      where: { companyId: a.ctx.companyId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ runs });
  } catch (err) {
    return serverError(err, "acquisition.runs.GET");
  }
}
