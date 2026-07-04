import type { Audience } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/activity";
import { ingestLead } from "./ingest";
import { enrichCandidate } from "./enrich";
import { searchProspects } from "./providers";

export interface DiscoverResult {
  provider: string;
  live: boolean;
  audience: string | null;
  audienceId: string | null;
  found: number;
  created: number;
  deduped: number;
  createdLeadIds: string[];
}

/**
 * Source prospects for one ICP (Audience) via every active provider, enrich
 * each candidate, then run them through the shared ingest pipeline (dedupe +
 * score + assign). New prospects land on their best channel, tagged "outbound".
 * With `autoDraft`, a first-touch outreach message is queued for approval —
 * still nothing is ever sent automatically.
 */
export async function discoverLeads(args: {
  companyId: string;
  audienceId?: string | null;
  limit?: number;
  autoDraft?: boolean;
  ownerId?: string | null;
  notifyOnCreate?: boolean;
}): Promise<DiscoverResult> {
  const limit = args.limit ?? 10;
  const notifyOnCreate = args.notifyOnCreate ?? true;

  const audience: Audience | null = args.audienceId
    ? await prisma.audience.findFirst({
        where: { id: args.audienceId, companyId: args.companyId, deletedAt: null },
      })
    : await prisma.audience.findFirst({
        where: { companyId: args.companyId, deletedAt: null, active: true },
        orderBy: { createdAt: "asc" },
      });

  const { candidates, providerNames, live } = await searchProspects({
    industry: audience?.industry ?? null,
    region: audience?.region ?? null,
    companySize: audience?.companySize ?? null,
    keywords: audience?.painPoints ?? [],
    painPoints: audience?.painPoints ?? [],
    limit,
  });

  let created = 0;
  let deduped = 0;
  const createdLeadIds: string[] = [];

  for (const c of candidates) {
    const e = enrichCandidate(c);
    const result = await ingestLead({
      companyId: args.companyId,
      input: e.input,
      source: c.source ?? "COLD_OUTREACH",
      tags: audience ? [...e.tags, `icp:${audience.id}`] : e.tags,
      priority: e.priority,
      draftContext: e.draftContext,
      ownerId: args.ownerId ?? null,
      autoDraft: args.autoDraft ?? false,
      silent: true,
    });
    if (result.deduped) deduped++;
    else {
      created++;
      createdLeadIds.push(result.leadId);
    }
  }

  if (created > 0 && notifyOnCreate) {
    await notify({
      companyId: args.companyId,
      type: "SYSTEM",
      title: `Discovery added ${created} new lead${created === 1 ? "" : "s"}`,
      body: `${live ? providerNames.join(" + ") : "Sample"} source${audience ? ` · ${audience.name}` : ""}${deduped ? ` · ${deduped} duplicate(s) skipped` : ""}`,
      link: "/leads",
    });
  }

  return {
    provider: providerNames.join("+"),
    live,
    audience: audience?.name ?? null,
    audienceId: audience?.id ?? null,
    found: candidates.length,
    created,
    deduped,
    createdLeadIds,
  };
}

export interface MultiDiscoverResult {
  totalFound: number;
  totalCreated: number;
  totalDeduped: number;
  createdLeadIds: string[];
  perAudience: DiscoverResult[];
  providerNames: string[];
  live: boolean;
}

/**
 * Spread a sourcing budget across every active ICP for a company. The autopilot
 * uses this so all audiences get worked, not just the first one. The per-batch
 * size is applied to each audience; the overall `budget` caps the total created.
 */
export async function discoverForAllAudiences(args: {
  companyId: string;
  perAudience: number;
  budget: number;
  autoDraft?: boolean;
  ownerId?: string | null;
}): Promise<MultiDiscoverResult> {
  const audiences = await prisma.audience.findMany({
    where: { companyId: args.companyId, deletedAt: null, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  // No ICP defined yet → still source against defaults (audienceId omitted).
  const targets = audiences.length ? audiences.map((a) => a.id) : [null];

  const perAudience: DiscoverResult[] = [];
  const createdLeadIds: string[] = [];
  let remaining = args.budget;

  for (const audienceId of targets) {
    if (remaining <= 0) break;
    const limit = Math.min(args.perAudience, remaining);
    const r = await discoverLeads({
      companyId: args.companyId,
      audienceId,
      limit,
      autoDraft: args.autoDraft,
      ownerId: args.ownerId,
      notifyOnCreate: false,
    });
    perAudience.push(r);
    createdLeadIds.push(...r.createdLeadIds);
    remaining -= r.created;
  }

  const totalCreated = perAudience.reduce((s, r) => s + r.created, 0);
  const totalDeduped = perAudience.reduce((s, r) => s + r.deduped, 0);
  const totalFound = perAudience.reduce((s, r) => s + r.found, 0);
  const live = perAudience.some((r) => r.live);
  const providerNames = Array.from(new Set(perAudience.flatMap((r) => r.provider.split("+")))).filter(Boolean);

  return { totalFound, totalCreated, totalDeduped, createdLeadIds, perAudience, providerNames, live };
}
