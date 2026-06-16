import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const notifications = await prisma.notification.findMany({
      where: {
        companyId: a.ctx.companyId,
        OR: [{ userId: a.ctx.userId }, { userId: null }],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return NextResponse.json(notifications);
  } catch (err) {
    return serverError(err, "notifications.GET");
  }
}
