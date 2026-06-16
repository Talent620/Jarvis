import type { ContentKind, SocialChannel, SocialPost } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/activity";
import { generateContent, logAiDecision } from "@/lib/ai";

// ---------------------------------------------------------------------------
// Channel connections — live when the relevant tokens are configured,
// simulated otherwise (same degrade-gracefully pattern as email/AI).
// ---------------------------------------------------------------------------

export interface ChannelStatus {
  channel: SocialChannel;
  live: boolean;
  detail: string;
}

export function getChannelStatuses(): ChannelStatus[] {
  const meta = Boolean(process.env.META_ACCESS_TOKEN);
  return [
    {
      channel: "FACEBOOK",
      live: meta && Boolean(process.env.FACEBOOK_PAGE_ID),
      detail: meta ? "Meta Graph API" : "Set META_ACCESS_TOKEN + FACEBOOK_PAGE_ID",
    },
    {
      channel: "INSTAGRAM",
      live: meta && Boolean(process.env.INSTAGRAM_BUSINESS_ID),
      detail: meta ? "Meta Graph API" : "Set META_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ID",
    },
    {
      channel: "GOOGLE_BUSINESS",
      live: Boolean(process.env.GBP_ACCESS_TOKEN && process.env.GBP_LOCATION_ID),
      detail: process.env.GBP_ACCESS_TOKEN
        ? "Business Profile API"
        : "Set GBP_ACCESS_TOKEN + GBP_LOCATION_ID",
    },
    {
      channel: "LINKEDIN",
      live: false,
      detail: "Copy-paste export (no API yet)",
    },
  ];
}

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

/** Pull "Headline:/CTA:/#tags" structure out of free-form AI ad copy. */
function parseAdCopy(text: string): {
  title: string | null;
  body: string;
  cta: string | null;
  hashtags: string[];
} {
  let title: string | null = null;
  let cta: string | null = null;
  const hashtags = Array.from(new Set(text.match(/#[\p{L}0-9_]+/gu) ?? [])).slice(0, 8);

  const lines = text.split("\n");
  const bodyLines: string[] = [];
  for (const line of lines) {
    const headline = line.match(/^\s*(?:headline|hook|nagłówek)\s*[:\-]\s*(.+)$/i);
    const ctaMatch = line.match(/^\s*(?:cta|call to action)\s*[:\-]\s*(.+)$/i);
    if (headline && !title) title = headline[1].trim().replace(/^["']|["']$/g, "");
    else if (ctaMatch && !cta) cta = ctaMatch[1].trim().replace(/^["']|["']$/g, "");
    else bodyLines.push(line);
  }
  let body = bodyLines.join("\n").trim();
  if (!title) {
    const first = body.split("\n").map((l) => l.trim()).find(Boolean);
    if (first && first.length <= 80) {
      title = first.replace(/^[#*\s]+/, "");
      body = body.split("\n").slice(1).join("\n").trim() || body;
    }
  }
  return { title, body: body || text.trim(), cta, hashtags };
}

/**
 * Generate a ready-to-review ad or organic post for a channel and save it as a
 * SocialPost draft. Uses the configured AI provider (mock fallback included).
 */
export async function generateSocialPost(args: {
  companyId: string;
  userId?: string | null;
  channel: SocialChannel;
  kind: ContentKind; // AD | POST
  topic: string;
  offerId?: string | null;
  link?: string | null;
}): Promise<SocialPost> {
  const [company, offer] = await Promise.all([
    prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true, industry: true, aiContext: true, currency: true, website: true },
    }),
    args.offerId
      ? prisma.offer.findFirst({
          where: { id: args.offerId, companyId: args.companyId, deletedAt: null },
        })
      : Promise.resolve(null),
  ]);
  if (!company) throw new Error("Company not found");

  const channelHint =
    args.channel === "INSTAGRAM"
      ? "Instagram: visual-first, short punchy lines, 5-8 niche hashtags, strong hook in line one."
      : args.channel === "FACEBOOK"
        ? "Facebook: conversational, social proof, a clear CTA button text, 2-3 hashtags max."
        : args.channel === "GOOGLE_BUSINESS"
          ? "Google Business Profile post: max ~1200 chars, locally relevant, one CTA (Call now / Learn more), no hashtags."
          : "LinkedIn: professional, value-led, light formatting, 3 hashtags.";

  const result = await generateContent({
    kind: args.kind,
    company: {
      name: company.name,
      industry: company.industry,
      aiContext: company.aiContext,
      currency: company.currency,
    },
    offer: offer
      ? { name: offer.name, summary: offer.summary, priceFrom: offer.priceFrom, deliverables: offer.deliverables }
      : undefined,
    channel: args.channel,
    userPrompt: `${args.kind === "AD" ? "Paid ad" : "Organic post"} for ${args.channel}. Topic/goal: ${args.topic}. ${channelHint} Structure the output with "Headline:" and "CTA:" lines.`,
  });

  const parsed = parseAdCopy(result.text);

  const post = await prisma.socialPost.create({
    data: {
      companyId: args.companyId,
      channel: args.channel,
      kind: args.kind,
      title: parsed.title,
      body: parsed.body,
      cta: parsed.cta,
      link: args.link ?? company.website ?? null,
      hashtags: parsed.hashtags,
      status: "DRAFT",
      isAiGenerated: true,
      meta: { provider: result.provider, fallback: result.fallback, topic: args.topic },
    },
  });

  await logAiDecision({
    companyId: args.companyId,
    userId: args.userId ?? null,
    actionType: "GENERATE_AD",
    status: result.fallback ? "FALLBACK" : "SUCCESS",
    provider: result.provider,
    model: result.model,
    promptKey: result.promptKey,
    inputSummary: `${args.kind} for ${args.channel}: ${args.topic.slice(0, 80)}`,
    output: result.text,
    tokensUsed: result.tokensUsed,
  });

  return post;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

interface PublishOutcome {
  ok: boolean;
  externalId?: string;
  error?: string;
  simulated: boolean;
}

function composeMessage(post: SocialPost): string {
  const parts = [post.title, post.body];
  if (post.cta) parts.push(`👉 ${post.cta}`);
  if (post.link && post.channel !== "FACEBOOK") parts.push(post.link); // FB takes link param
  if (post.hashtags.length) parts.push(post.hashtags.join(" "));
  return parts.filter(Boolean).join("\n\n");
}

async function publishToFacebook(post: SocialPost): Promise<PublishOutcome> {
  const token = process.env.META_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!token || !pageId) {
    return { ok: true, externalId: `sim_fb_${Date.now().toString(36)}`, simulated: true };
  }
  const params = new URLSearchParams({ message: composeMessage(post), access_token: token });
  if (post.link) params.set("link", post.link);
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    return { ok: false, error: data.error?.message ?? `Graph API ${res.status}`, simulated: false };
  }
  return { ok: true, externalId: data.id, simulated: false };
}

async function publishToInstagram(post: SocialPost): Promise<PublishOutcome> {
  const token = process.env.META_ACCESS_TOKEN;
  const igId = process.env.INSTAGRAM_BUSINESS_ID;
  if (!post.imageUrl) {
    return { ok: false, error: "Instagram requires an image URL", simulated: !token };
  }
  if (!token || !igId) {
    return { ok: true, externalId: `sim_ig_${Date.now().toString(36)}`, simulated: true };
  }
  const createRes = await fetch(`https://graph.facebook.com/v19.0/${igId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      image_url: post.imageUrl,
      caption: composeMessage(post),
      access_token: token,
    }).toString(),
  });
  const container = (await createRes.json()) as { id?: string; error?: { message?: string } };
  if (!createRes.ok || !container.id) {
    return { ok: false, error: container.error?.message ?? `Graph API ${createRes.status}`, simulated: false };
  }
  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: container.id, access_token: token }).toString(),
  });
  const published = (await publishRes.json()) as { id?: string; error?: { message?: string } };
  if (!publishRes.ok || !published.id) {
    return { ok: false, error: published.error?.message ?? `Graph API ${publishRes.status}`, simulated: false };
  }
  return { ok: true, externalId: published.id, simulated: false };
}

async function publishToGoogleBusiness(post: SocialPost): Promise<PublishOutcome> {
  const token = process.env.GBP_ACCESS_TOKEN;
  const location = process.env.GBP_LOCATION_ID; // "accounts/{a}/locations/{l}"
  if (!token || !location) {
    return { ok: true, externalId: `sim_gbp_${Date.now().toString(36)}`, simulated: true };
  }
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${location}/localPosts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        languageCode: "pl",
        summary: composeMessage(post).slice(0, 1500),
        topicType: "STANDARD",
        ...(post.link
          ? { callToAction: { actionType: "LEARN_MORE", url: post.link } }
          : {}),
      }),
    },
  );
  const data = (await res.json()) as { name?: string; error?: { message?: string } };
  if (!res.ok || !data.name) {
    return { ok: false, error: data.error?.message ?? `GBP API ${res.status}`, simulated: false };
  }
  return { ok: true, externalId: data.name, simulated: false };
}

/**
 * Publish one post to its channel (live API when connected, simulated when
 * not) and persist the outcome. LinkedIn stays export-only.
 */
export async function publishSocialPost(args: {
  companyId: string;
  postId: string;
}): Promise<SocialPost> {
  const post = await prisma.socialPost.findFirst({
    where: { id: args.postId, companyId: args.companyId, deletedAt: null },
  });
  if (!post) throw new Error("Post not found");
  if (post.status === "PUBLISHED") return post;

  let outcome: PublishOutcome;
  switch (post.channel) {
    case "FACEBOOK":
      outcome = await publishToFacebook(post);
      break;
    case "INSTAGRAM":
      outcome = await publishToInstagram(post);
      break;
    case "GOOGLE_BUSINESS":
      outcome = await publishToGoogleBusiness(post);
      break;
    default:
      outcome = { ok: false, error: "LinkedIn publishing is export-only — copy the text", simulated: true };
  }

  const updated = await prisma.socialPost.update({
    where: { id: post.id },
    data: outcome.ok
      ? {
          status: "PUBLISHED",
          publishedAt: new Date(),
          externalId: outcome.externalId,
          error: null,
          meta: { ...((post.meta as object) ?? {}), simulated: outcome.simulated },
        }
      : { status: "FAILED", error: outcome.error },
  });

  await notify({
    companyId: args.companyId,
    type: "SYSTEM",
    title: outcome.ok
      ? `Post published to ${post.channel}${outcome.simulated ? " (simulated)" : ""}`
      : `Publishing to ${post.channel} failed`,
    body: outcome.ok ? post.title ?? post.body.slice(0, 80) : outcome.error,
    link: "/social",
  });

  return updated;
}

/** Publish every scheduled post that is due. Used by the autopilot tick. */
export async function publishDuePosts(companyId: string): Promise<{ published: number; failed: number }> {
  const due = await prisma.socialPost.findMany({
    where: {
      companyId,
      deletedAt: null,
      status: "SCHEDULED",
      scheduledAt: { lte: new Date() },
    },
    select: { id: true },
    take: 10,
  });
  let published = 0;
  let failed = 0;
  for (const p of due) {
    try {
      const r = await publishSocialPost({ companyId, postId: p.id });
      if (r.status === "PUBLISHED") published++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { published, failed };
}
