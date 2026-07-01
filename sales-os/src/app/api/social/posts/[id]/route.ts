import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { socialPostUpdateSchema } from "@/lib/validations";
import { isPublishedLike } from "@/lib/social/statusPolicy";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, socialPostUpdateSchema);
  if ("res" in b) return b.res;

  try {
    const post = await prisma.socialPost.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
    });
    if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Wspólna polityka: potwierdzona publikacja (PUBLISHED_CONFIRMED albo legacy PUBLISHED) jest
    // niezmienialna. SIMULATED/DRAFT/FAILED pozostają edytowalne.
    if (isPublishedLike(post.status)) {
      return NextResponse.json({ error: "Published posts cannot be edited" }, { status: 409 });
    }

    const updated = await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        ...b.data,
        // Setting a schedule moves the post into the SCHEDULED state;
        // clearing it returns the post to DRAFT.
        ...(b.data.scheduledAt !== undefined
          ? { status: b.data.scheduledAt ? "SCHEDULED" : "DRAFT" }
          : {}),
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return serverError(err, "social.post.PATCH");
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const post = await prisma.socialPost.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.socialPost.update({
      where: { id: post.id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "social.post.DELETE");
  }
}
