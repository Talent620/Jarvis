import { prisma } from "@/lib/prisma";
import { ingestLead } from "@/lib/acquisition/ingest";
import { auditLead } from "@/lib/audit";
import { googlePlacesProvider } from "./google-places";
import { ceidgProvider } from "./ceidg";
import { mockBusinessProvider } from "./mock";
import type { BusinessCandidate, BusinessProvider, BusinessQuery } from "./types";

export type { BusinessCandidate, BusinessQuery } from "./types";

/**
 * Active local-business providers. Real APIs activate when their key is set;
 * otherwise the zero-config sample source keeps the Lead Finder working.
 */
export function getBusinessProviders(): BusinessProvider[] {
  const providers: BusinessProvider[] = [];
  if (process.env.GOOGLE_PLACES_API_KEY) {
    providers.push(googlePlacesProvider(process.env.GOOGLE_PLACES_API_KEY));
  }
  if (process.env.CEIDG_API_TOKEN) {
    providers.push(ceidgProvider(process.env.CEIDG_API_TOKEN));
  }
  if (providers.length === 0) providers.push(mockBusinessProvider);
  return providers;
}

function dedupeKey(c: BusinessCandidate): string {
  if (c.phone) return `p:${c.phone.replace(/\s+/g, "")}`;
  if (c.website) return `w:${c.website.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return `n:${c.name}|${c.city ?? ""}`.toLowerCase();
}

export interface BusinessSearchResult {
  candidates: BusinessCandidate[];
  providerNames: string[];
  live: boolean;
  noWebsiteCount: number;
}

/**
 * Fan the query out across all active providers, merge + dedupe, then rank:
 * businesses WITHOUT a website first (the easiest sale), then weak sites,
 * then by review-count gap. Optionally hard-filters to no-website only.
 */
export async function searchBusinesses(q: BusinessQuery): Promise<BusinessSearchResult> {
  const providers = getBusinessProviders();
  const results = await Promise.all(providers.map((p) => p.search(q)));

  const seen = new Set<string>();
  let merged: BusinessCandidate[] = [];
  for (const list of results) {
    for (const c of list) {
      const key = dedupeKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(c);
    }
  }

  if (q.noWebsiteOnly) merged = merged.filter((c) => !c.hasWebsite);

  merged.sort((a, b) => {
    if (a.hasWebsite !== b.hasWebsite) return a.hasWebsite ? 1 : -1;
    return b.signals.length - a.signals.length;
  });

  const clamped = merged.slice(0, q.limit);
  return {
    candidates: clamped,
    providerNames: providers.map((p) => p.name),
    live: providers.some((p) => p.live),
    noWebsiteCount: clamped.filter((c) => !c.hasWebsite).length,
  };
}

export interface ImportBusinessesResult {
  created: number;
  deduped: number;
  audited: number;
  createdLeadIds: string[];
}

/**
 * Turn selected business candidates into leads through the shared ingest
 * pipeline (dedupe + score + assign + optional AI first-touch draft), then
 * mark the website status and optionally run a website audit so the call/email
 * has concrete facts to reference.
 */
export async function importBusinesses(args: {
  companyId: string;
  candidates: BusinessCandidate[];
  ownerId?: string | null;
  autoDraft?: boolean;
  autoAudit?: boolean;
}): Promise<ImportBusinessesResult> {
  let created = 0;
  let deduped = 0;
  let audited = 0;
  const createdLeadIds: string[] = [];

  for (const c of args.candidates) {
    const tags = ["local-business"];
    if (!c.hasWebsite) tags.push("no-website");
    if (c.registeredAt) tags.push("new-company");

    const result = await ingestLead({
      companyId: args.companyId,
      input: {
        name: c.name,
        email: c.email ?? null,
        phone: c.phone ?? null,
        companyName: c.name,
        website: c.website ?? null,
        industry: c.category ?? null,
        region: c.city ?? null,
        sourceDetail: c.sourceDetail,
        message: c.signals.length ? `Signals: ${c.signals.join("; ")}` : null,
      },
      source: c.source,
      sourceDetail: c.sourceDetail,
      tags,
      ownerId: args.ownerId ?? null,
      priority: c.hasWebsite ? "MEDIUM" : "HIGH",
      draftContext: c.signals.join("; ") || null,
      autoDraft: args.autoDraft ?? false,
      silent: true,
    });

    if (result.deduped) {
      deduped++;
      continue;
    }
    created++;
    createdLeadIds.push(result.leadId);

    await prisma.lead.update({
      where: { id: result.leadId },
      data: {
        hasWebsite: c.hasWebsite,
        nextActionNote: c.hasWebsite
          ? "Audit the website, then call with concrete findings"
          : "Call — they have no website yet",
      },
    });

    if (args.autoAudit && c.website && c.hasWebsite) {
      try {
        await auditLead({ companyId: args.companyId, leadId: result.leadId });
        audited++;
      } catch (e) {
        console.error("[prospecting] auto-audit failed:", e);
      }
    }
  }

  return { created, deduped, audited, createdLeadIds };
}

/**
 * Autopilot hook: run every configured "category @ city" prospecting query and
 * import what it finds (bounded by `budget`). Returns counters for the run log.
 */
export async function prospectForCompany(args: {
  companyId: string;
  queries: string[];
  noWebsiteOnly: boolean;
  budget: number;
  autoDraft?: boolean;
  autoAudit?: boolean;
}): Promise<ImportBusinessesResult & { found: number }> {
  let remaining = args.budget;
  const totals: ImportBusinessesResult & { found: number } = {
    created: 0, deduped: 0, audited: 0, createdLeadIds: [], found: 0,
  };

  for (const line of args.queries) {
    if (remaining <= 0) break;
    const [category, city] = line.split("@").map((s) => s.trim());
    if (!category || !city) continue;

    const { candidates } = await searchBusinesses({
      category,
      city,
      limit: Math.min(remaining, 10),
      noWebsiteOnly: args.noWebsiteOnly,
    });
    totals.found += candidates.length;

    const r = await importBusinesses({
      companyId: args.companyId,
      candidates,
      autoDraft: args.autoDraft,
      autoAudit: args.autoAudit,
    });
    totals.created += r.created;
    totals.deduped += r.deduped;
    totals.audited += r.audited;
    totals.createdLeadIds.push(...r.createdLeadIds);
    remaining -= r.created;
  }

  return totals;
}
