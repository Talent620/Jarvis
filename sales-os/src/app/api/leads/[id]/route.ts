import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { leadUpdateSchema } from "@/lib/validations";
import { recomputeLeadScore } from "@/lib/lead-service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const lead = await prisma.lead.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      include: { stage: true, owner: { select: { name: true, email: true } } },
    });
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(lead);
  } catch (err) {
    return serverError(err, "lead.GET");
  }
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, leadUpdateSchema);
  if ("res" in b) return b.res;

  try {
    const existing = await prisma.lead.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { email, ...rest } = b.data;
    const updated = await prisma.lead.update({
      where: { id: params.id },
      data: { ...rest, ...(email !== undefined ? { email: email || null } : {}) },
    });

    const score = await recomputeLeadScore(updated);
    return NextResponse.json({ ...updated, score: score.score, scoreGrade: score.grade });
  } catch (err) {
    return serverError(err, "lead.PATCH");
  }
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const existing = await prisma.lead.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Soft delete.
    await prisma.lead.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "lead.DELETE");
  }
}
