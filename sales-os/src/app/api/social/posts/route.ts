import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const posts = await prisma.socialPost.findMany({
      where: { companyId: a.ctx.companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json(posts);
  } catch (err) {
    return serverError(err, "social.posts.GET");
  }
}
