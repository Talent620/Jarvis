import { NextResponse } from "next/server";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { socialGenerateSchema } from "@/lib/validations";
import { generateSocialPost } from "@/lib/social";

export const dynamic = "force-dynamic";

/** Have AI draft an ad / post for a channel; saved as a SocialPost draft. */
export async function POST(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, socialGenerateSchema);
  if ("res" in b) return b.res;

  try {
    const post = await generateSocialPost({
      companyId: a.ctx.companyId,
      userId: a.ctx.userId,
      channel: b.data.channel,
      kind: b.data.kind ?? "POST",
      topic: b.data.topic,
      offerId: b.data.offerId ?? null,
      link: b.data.link ?? null,
    });
    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    return serverError(err, "social.generate");
  }
}
