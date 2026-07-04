import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Global quick search (command palette): leads by name/company/phone/email. */
export async function GET(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ leads: [] });

  try {
    const leads = await prisma.lead.findMany({
      where: {
        companyId: a.ctx.companyId,
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { companyName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      },
      orderBy: { score: "desc" },
      take: 8,
      select: {
        id: true,
        name: true,
        companyName: true,
        phone: true,
        email: true,
        score: true,
        scoreGrade: true,
        callStatus: true,
        hasWebsite: true,
      },
    });
    return NextResponse.json({ leads });
  } catch (err) {
    return serverError(err, "search.GET");
  }
}
