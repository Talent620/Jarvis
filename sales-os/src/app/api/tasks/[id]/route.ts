import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { taskUpdateSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, taskUpdateSchema);
  if ("res" in b) return b.res;

  try {
    const existing = await prisma.task.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const completing = b.data.status === "DONE" && existing.status !== "DONE";
    const reopening = b.data.status && b.data.status !== "DONE" && existing.status === "DONE";

    const task = await prisma.task.update({
      where: { id: params.id },
      data: {
        ...b.data,
        ...(completing ? { completedAt: new Date() } : {}),
        ...(reopening ? { completedAt: null } : {}),
      },
    });
    return NextResponse.json(task);
  } catch (err) {
    return serverError(err, "task.PATCH");
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const existing = await prisma.task.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.task.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "task.DELETE");
  }
}
