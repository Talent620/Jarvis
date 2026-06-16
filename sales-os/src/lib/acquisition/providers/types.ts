import type { LeadSource } from "@prisma/client";

export interface ProspectCandidate {
  name: string;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  position?: string | null;
  website?: string | null;
  industry?: string | null;
  region?: string | null;
  companySize?: string | null;
  /** Buying-intent signals the provider surfaced (e.g. "hiring", "recent funding"). */
  signals?: string[];
  /** 0..100 provider-side intent estimate; folded into prioritisation. */
  intentScore?: number;
  /** Channel this prospect is best reached on — drives the Lead.source. */
  source?: LeadSource | null;
  sourceDetail?: string | null;
}

export interface ProspectQuery {
  industry?: string | null;
  region?: string | null;
  companySize?: string | null;
  keywords?: string[];
  painPoints?: string[];
  limit: number;
}

export interface ProspectingProvider {
  name: string;
  /** true when backed by a real data API (key present); false for the mock. */
  live: boolean;
  search(q: ProspectQuery): Promise<ProspectCandidate[]>;
}
