import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { taskCreateSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;

    const where: Prisma.TaskWhereInput = {
      companyId: a.ctx.companyId,
      deletedAt: null,
      ...(status ? { status: status as never } : {}),
    };

    const tasks = await prisma.task.findMany({
      where,
      include: { lead: { select: { id: true, name: true, companyName: true } } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 200,
    });
    return NextResponse.json(tasks);
  } catch (err) {
    return serverError(err, "tasks.GET");
  }
}

export async function POST(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, taskCreateSchema);
  if ("res" in b) return b.res;

  try {
    const task = await prisma.task.create({
      data: {
        companyId: a.ctx.companyId,
        assigneeId: a.ctx.userId,
        title: b.data.title,
        description: b.data.description,
        priority: b.data.priority,
        status: b.data.status,
        dueDate: b.data.dueDate,
        leadId: b.data.leadId,
        source: "MANUAL",
      },
    });

    if (b.data.leadId) {
      await prisma.leadActivity.create({
        data: {
          companyId: a.ctx.companyId,
          leadId: b.data.leadId,
          userId: a.ctx.userId,
          type: "TASK_CREATED",
          title: `Task: ${b.data.title}`,
        },
      });
    }

    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    return serverError(err, "tasks.POST");
  }
}
