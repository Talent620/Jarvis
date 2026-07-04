import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const existing = await prisma.notification.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.notification.update({ where: { id: params.id }, data: { read: true } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "notification.PATCH");
  }
}
