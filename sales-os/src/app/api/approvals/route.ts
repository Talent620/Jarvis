import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuth, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;

    const where: Prisma.ApprovalRequestWhereInput = {
      companyId: a.ctx.companyId,
      ...(status ? { status: status as never } : {}),
    };

    const approvals = await prisma.approvalRequest.findMany({
      where,
      include: {
        lead: { select: { id: true, name: true, companyName: true } },
        requestedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json(approvals);
  } catch (err) {
    return serverError(err, "approvals.GET");
  }
}
