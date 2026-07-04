import type { ProspectCandidate, ProspectingProvider, ProspectQuery } from "./types";
import { mockProvider } from "./mock";

/**
 * Apollo.io people search (best-effort). Activated when APOLLO_API_KEY is set.
 * On any failure it returns [] so the caller can degrade gracefully.
 */
function apolloProvider(apiKey: string): ProspectingProvider {
  return {
    name: "apollo",
    live: true,
    async search(q: ProspectQuery): Promise<ProspectCandidate[]> {
      try {
        const res = await fetch("https://api.apollo.io/v1/mixed_people/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
          body: JSON.stringify({
            page: 1,
            per_page: q.limit,
            person_titles: q.keywords?.length ? q.keywords : undefined,
            organization_locations: q.region ? [q.region] : undefined,
          }),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { people?: unknown[] };
        const people = Array.isArray(data.people) ? data.people : [];
        return people.slice(0, q.limit).map((p) => {
          const o = p as Record<string, unknown>;
          const org = (o.organization ?? {}) as Record<string, unknown>;
          return {
            name: String(o.name ?? `${o.first_name ?? ""} ${o.last_name ?? ""}`).trim() || "Prospect",
            email: typeof o.email === "string" ? o.email : null,
            companyName: typeof org.name === "string" ? org.name : null,
            position: typeof o.title === "string" ? o.title : null,
            website: typeof org.website_url === "string" ? org.website_url : null,
            industry: typeof org.industry === "string" ? org.industry : q.industry ?? null,
            region: typeof o.city === "string" ? o.city : q.region ?? null,
            companySize:
              typeof org.estimated_num_employees === "number"
                ? String(org.estimated_num_employees)
                : null,
            signals: [],
            source: "COLD_OUTREACH",
            sourceDetail: "Apollo.io",
          } satisfies ProspectCandidate;
        });
      } catch (e) {
        console.error("[acquisition] apollo search failed:", e);
        return [];
      }
    },
  };
}

/**
 * Hunter.io domain search (best-effort). Activated when HUNTER_API_KEY is set.
 * Hunter is domain-centric, so this is a light adapter; returns [] on failure.
 */
function hunterProvider(apiKey: string): ProspectingProvider {
  return {
    name: "hunter",
    live: true,
    async search(q: ProspectQuery): Promise<ProspectCandidate[]> {
      try {
        const params = new URLSearchParams({ api_key: apiKey, limit: String(q.limit) });
        if (q.keywords?.[0]) params.set("company", q.keywords[0]);
        const res = await fetch(`https://api.hunter.io/v2/domain-search?${params.toString()}`);
        if (!res.ok) return [];
        const data = (await res.json()) as {
          data?: { organization?: string; emails?: unknown[] };
        };
        const emails = Array.isArray(data.data?.emails) ? data.data!.emails! : [];
        return emails.slice(0, q.limit).map((e) => {
          const o = e as Record<string, unknown>;
          return {
            name:
              `${o.first_name ?? ""} ${o.last_name ?? ""}`.trim() ||
              (typeof o.value === "string" ? o.value : "Prospect"),
            email: typeof o.value === "string" ? o.value : null,
            companyName: data.data?.organization ?? null,
            position: typeof o.position === "string" ? o.position : null,
            industry: q.industry ?? null,
            region: q.region ?? null,
            signals: [],
            source: "COLD_OUTREACH",
            sourceDetail: "Hunter.io",
          } satisfies ProspectCandidate;
        });
      } catch (e) {
        console.error("[acquisition] hunter search failed:", e);
        return [];
      }
    },
  };
}

/**
 * Active providers, in priority order. Real data APIs are used when their key
 * is present; otherwise the zero-config mock keeps the engine working (incl.
 * offline / in the demo). Multiple live providers can run together.
 */
export function getProspectingProviders(): ProspectingProvider[] {
  const providers: ProspectingProvider[] = [];
  if (process.env.APOLLO_API_KEY) providers.push(apolloProvider(process.env.APOLLO_API_KEY));
  if (process.env.HUNTER_API_KEY) providers.push(hunterProvider(process.env.HUNTER_API_KEY));
  if (providers.length === 0) providers.push(mockProvider);
  return providers;
}

/** Back-compat single-provider accessor (first active provider). */
export function getProspectingProvider(): ProspectingProvider {
  return getProspectingProviders()[0];
}

function dedupeKey(c: ProspectCandidate): string {
  if (c.email) return `e:${c.email.toLowerCase()}`;
  if (c.website) return `w:${c.website.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return `n:${(c.companyName ?? "")}|${c.name}`.toLowerCase();
}

export interface CombinedSearch {
  candidates: ProspectCandidate[];
  providerNames: string[];
  live: boolean;
}

/**
 * Fan a query out across all active providers, merge + dedupe the results,
 * rank by intent and clamp to the requested limit. Provider failures are
 * swallowed (each returns [] on error), so partial sourcing still succeeds.
 */
export async function searchProspects(q: ProspectQuery): Promise<CombinedSearch> {
  const providers = getProspectingProviders();
  const results = await Promise.all(providers.map((p) => p.search({ ...q, limit: q.limit })));

  const seen = new Set<string>();
  const merged: ProspectCandidate[] = [];
  for (const list of results) {
    for (const c of list) {
      const key = dedupeKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(c);
    }
  }
  merged.sort((a, b) => (b.intentScore ?? 0) - (a.intentScore ?? 0));

  return {
    candidates: merged.slice(0, q.limit),
    providerNames: providers.map((p) => p.name),
    live: providers.some((p) => p.live),
  };
}
