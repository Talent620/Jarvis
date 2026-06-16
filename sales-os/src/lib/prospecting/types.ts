import type { LeadSource } from "@prisma/client";

/** Search request for local-business prospecting (Google Maps / registries). */
export interface BusinessQuery {
  /** Business category / niche, e.g. "fryzjer", "warsztat samochodowy". */
  category: string;
  /** City / area to search, e.g. "Warszawa". */
  city: string;
  /** Max candidates to return. */
  limit: number;
  /** Only return businesses with NO website (prime web-design leads). */
  noWebsiteOnly?: boolean;
}

/** One business surfaced by a prospecting provider. */
export interface BusinessCandidate {
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  hasWebsite: boolean;
  address?: string | null;
  city?: string | null;
  category?: string | null;
  rating?: number | null;       // Google rating 0..5
  reviewCount?: number | null;
  mapsUrl?: string | null;      // link to the Google Maps listing
  nip?: string | null;          // Polish tax id (registry results)
  registeredAt?: string | null; // ISO date the company was registered (registry)
  /** Sales angles spotted by the provider ("No website", "Few reviews"…). */
  signals: string[];
  source: LeadSource;           // GOOGLE_MAPS | BUSINESS_REGISTRY
  sourceDetail: string;         // e.g. "Google Places" | "CEIDG"
}

export interface BusinessProvider {
  name: string;
  live: boolean;
  search(q: BusinessQuery): Promise<BusinessCandidate[]>;
}
