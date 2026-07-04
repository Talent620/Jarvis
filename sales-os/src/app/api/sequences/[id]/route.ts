import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError, err } from "@/lib/api";
import { sequenceUpdateSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

async function owned(companyId: string, id: string) {
  return prisma.sequence.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true } });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, sequenceUpdateSchema);
  if ("res" in b) return b.res;

  try {
    if (!(await owned(a.ctx.companyId, params.id))) return err("Not found", 404);

    if (b.data.isDefault) {
      await prisma.sequence.updateMany({
        where: { companyId: a.ctx.companyId, isDefault: true, id: { not: params.id } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.sequence.update({
      where: { id: params.id },
      data: {
        name: b.data.name,
        description: b.data.description ?? undefined,
        channel: b.data.channel,
        active: b.data.active,
        isDefault: b.data.isDefault,
        audienceId: b.data.audienceId ?? undefined,
        offerId: b.data.offerId ?? undefined,
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    return NextResponse.json(updated);
  } catch (e) {
    return serverError(e, "sequences.PATCH");
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;
  try {
    if (!(await owned(a.ctx.companyId, params.id))) return err("Not found", 404);
    await prisma.sequence.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), active: false, isDefault: false },
    });
    // Stop any active enrollments on this sequence.
    await prisma.sequenceEnrollment.updateMany({
      where: { sequenceId: params.id, status: "ACTIVE" },
      data: { status: "STOPPED", nextRunAt: null },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "sequences.DELETE");
  }
}
