import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getChannelStatuses } from "@/lib/social";
import { SocialClient } from "@/components/social/social-client";

export const dynamic = "force-dynamic";

export default async function SocialPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  const { companyId } = a.ctx;

  const [posts, offers, publishedCount, scheduledCount] = await Promise.all([
    prisma.socialPost.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.offer.findMany({
      where: { companyId, deletedAt: null, active: true },
      orderBy: { tier: "asc" },
      select: { id: true, name: true },
    }),
    prisma.socialPost.count({ where: { companyId, deletedAt: null, status: "PUBLISHED" } }),
    prisma.socialPost.count({ where: { companyId, deletedAt: null, status: "SCHEDULED" } }),
  ]);

  return (
    <SocialClient
      posts={posts.map((p) => ({
        id: p.id,
        channel: p.channel,
        kind: p.kind,
        title: p.title,
        body: p.body,
        cta: p.cta,
        link: p.link,
        imageUrl: p.imageUrl,
        hashtags: p.hashtags,
        status: p.status,
        scheduledAt: p.scheduledAt?.toISOString() ?? null,
        publishedAt: p.publishedAt?.toISOString() ?? null,
        externalId: p.externalId,
        error: p.error,
        simulated: Boolean((p.meta as Record<string, unknown> | null)?.simulated),
        createdAt: p.createdAt.toISOString(),
      }))}
      offers={offers}
      channels={getChannelStatuses()}
      kpis={{ publishedCount, scheduledCount, draftCount: posts.filter((p) => p.status === "DRAFT").length }}
    />
  );
}
