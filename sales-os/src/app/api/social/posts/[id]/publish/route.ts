import { NextResponse } from "next/server";
import { getAuth, serverError } from "@/lib/api";
import { publishSocialPost } from "@/lib/social";

export const dynamic = "force-dynamic";

/** Publish the post to its channel now (live API or simulated). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const post = await publishSocialPost({
      companyId: a.ctx.companyId,
      postId: params.id,
    });
    return NextResponse.json(post);
  } catch (err) {
    return serverError(err, "social.publish");
  }
}
