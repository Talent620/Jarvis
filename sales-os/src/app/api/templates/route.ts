import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { templateCreateSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const templates = await prisma.template.findMany({
      where: { companyId: a.ctx.companyId, deletedAt: null },
      orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }],
    });
    return NextResponse.json(templates);
  } catch (err) {
    return serverError(err, "templates.GET");
  }
}

export async function POST(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, templateCreateSchema);
  if ("res" in b) return b.res;

  try {
    const template = await prisma.template.create({
      data: { companyId: a.ctx.companyId, ...b.data },
    });
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    return serverError(err, "templates.POST");
  }
}
