import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { noteCreateSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, noteCreateSchema);
  if ("res" in b) return b.res;

  try {
    const lead = await prisma.lead.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const note = await prisma.note.create({
      data: {
        companyId: a.ctx.companyId,
        leadId: params.id,
        authorId: a.ctx.userId,
        body: b.data.body,
        pinned: b.data.pinned,
      },
      include: { author: { select: { name: true } } },
    });

    await prisma.leadActivity.create({
      data: {
        companyId: a.ctx.companyId,
        leadId: params.id,
        userId: a.ctx.userId,
        type: "NOTE",
        title: "Note added",
        body: b.data.body.slice(0, 280),
      },
    });

    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    return serverError(err, "lead.notes.POST");
  }
}
