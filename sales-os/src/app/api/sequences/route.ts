import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { sequenceCreateSchema } from "@/lib/validations";
import { DEFAULT_SEQUENCE_STEPS } from "@/lib/acquisition/sequences";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await getAuth();
  if ("res" in a) return a.res;
  try {
    const sequences = await prisma.sequence.findMany({
      where: { companyId: a.ctx.companyId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: {
        steps: { orderBy: { order: "asc" } },
        _count: { select: { enrollments: true } },
      },
    });

    // Active enrollment counts per sequence (cheap group-by).
    const active = await prisma.sequenceEnrollment.groupBy({
      by: ["sequenceId"],
      where: { companyId: a.ctx.companyId, status: "ACTIVE" },
      _count: { _all: true },
    });
    const activeMap = new Map(active.map((r) => [r.sequenceId, r._count._all]));

    return NextResponse.json({
      sequences: sequences.map((s) => ({
        ...s,
        activeEnrollments: activeMap.get(s.id) ?? 0,
      })),
    });
  } catch (err) {
    return serverError(err, "sequences.GET");
  }
}

export async function POST(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, sequenceCreateSchema);
  if ("res" in b) return b.res;

  try {
    const steps = b.data.steps ?? DEFAULT_SEQUENCE_STEPS;

    // Only one default sequence per company.
    if (b.data.isDefault) {
      await prisma.sequence.updateMany({
        where: { companyId: a.ctx.companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const sequence = await prisma.sequence.create({
      data: {
        companyId: a.ctx.companyId,
        name: b.data.name,
        description: b.data.description ?? null,
        channel: b.data.channel,
        active: b.data.active,
        isDefault: b.data.isDefault,
        audienceId: b.data.audienceId ?? null,
        offerId: b.data.offerId ?? null,
        steps: {
          create: steps.map((s, i) => ({
            order: s.order ?? i + 1,
            dayOffset: s.dayOffset,
            channel: s.channel,
            kind: s.kind,
            name: s.name,
            prompt: s.prompt ?? null,
          })),
        },
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });

    return NextResponse.json(sequence, { status: 201 });
  } catch (err) {
    return serverError(err, "sequences.POST");
  }
}
