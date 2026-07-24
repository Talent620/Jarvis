import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { callLogCreateSchema } from "@/lib/validations";
import { logActivity } from "@/lib/activity";
import { CALL_STATUS_META } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const calls = await prisma.callLog.findMany({
      where: { leadId: params.id, companyId: a.ctx.companyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { name: true } } },
    });
    return NextResponse.json(calls);
  } catch (err) {
    return serverError(err, "calls.GET");
  }
}

/** Log a call: writes the CallLog, mirrors status onto the lead, logs the
 * timeline entry and (for callbacks) creates the follow-up task. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, callLogCreateSchema);
  if ("res" in b) return b.res;

  try {
    const lead = await prisma.lead.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const now = new Date();
    const call = await prisma.callLog.create({
      data: {
        companyId: a.ctx.companyId,
        leadId: lead.id,
        userId: a.ctx.userId,
        status: b.data.status,
        note: b.data.note ?? null,
        durationSec: b.data.durationSec ?? null,
        nextCallAt: b.data.nextCallAt ?? null,
      },
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        callStatus: b.data.status,
        callAttempts: { increment: 1 },
        lastCallAt: now,
        lastContactedAt: now,
        nextCallAt: b.data.nextCallAt ?? null,
        ...(b.data.status === "MEETING_BOOKED" ? { priority: "URGENT" } : {}),
      },
    });

    await logActivity({
      companyId: a.ctx.companyId,
      leadId: lead.id,
      userId: a.ctx.userId,
      type: "CALL",
      title: `Call · ${CALL_STATUS_META[b.data.status].label}`,
      body: b.data.note ?? null,
      meta: { status: b.data.status, durationSec: b.data.durationSec ?? null },
    });

    if (b.data.status === "CALLBACK" && b.data.nextCallAt) {
      await prisma.task.create({
        data: {
          companyId: a.ctx.companyId,
          leadId: lead.id,
          assigneeId: a.ctx.userId,
          title: `Call back ${lead.name}`,
          description: b.data.note ?? undefined,
          priority: "HIGH",
          source: "SYSTEM",
          dueDate: b.data.nextCallAt,
        },
      });
    }

    return NextResponse.json(call, { status: 201 });
  } catch (err) {
    return serverError(err, "calls.POST");
  }
}
