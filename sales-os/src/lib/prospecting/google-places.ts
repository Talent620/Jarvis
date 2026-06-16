import type { BusinessCandidate, BusinessProvider, BusinessQuery } from "./types";

interface PlaceResult {
  displayName?: { text?: string };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
}

const FIELD_MASK = [
  "places.displayName",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
].join(",");

function signalsFor(p: PlaceResult): string[] {
  const signals: string[] = [];
  if (!p.websiteUri) signals.push("No website — needs one");
  if ((p.userRatingCount ?? 0) < 10) signals.push("Few Google reviews");
  if (p.rating != null && p.rating < 4) signals.push(`Rating only ${p.rating.toFixed(1)}★`);
  if (p.websiteUri && /facebook\.com|instagram\.com/i.test(p.websiteUri)) {
    signals.push("Only a social profile, no real site");
  }
  return signals;
}

/**
 * Google Places API (New) text search. Finds real local businesses with phone
 * numbers and — crucially — tells us whether they have a website at all.
 * Activated by GOOGLE_PLACES_API_KEY; returns [] on any failure so the caller
 * degrades gracefully.
 */
export function googlePlacesProvider(apiKey: string): BusinessProvider {
  return {
    name: "google-places",
    live: true,
    async search(q: BusinessQuery): Promise<BusinessCandidate[]> {
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery: `${q.category} w ${q.city}`,
            // Over-fetch so a post-filter for "no website" still fills the page.
            pageSize: Math.min(20, Math.max(q.limit, 10)),
          }),
        });
        if (!res.ok) {
          console.error("[prospecting] places error", res.status, await res.text());
          return [];
        }
        const data = (await res.json()) as { places?: PlaceResult[] };
        const places = Array.isArray(data.places) ? data.places : [];
        return places
          .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY")
          .map((p) => {
            const social = p.websiteUri && /facebook\.com|instagram\.com/i.test(p.websiteUri);
            return {
              name: p.displayName?.text ?? "Local business",
              phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
              website: p.websiteUri ?? null,
              hasWebsite: Boolean(p.websiteUri) && !social,
              address: p.formattedAddress ?? null,
              city: q.city,
              category: p.primaryTypeDisplayName?.text ?? q.category,
              rating: p.rating ?? null,
              reviewCount: p.userRatingCount ?? null,
              mapsUrl: p.googleMapsUri ?? null,
              signals: signalsFor(p),
              source: "GOOGLE_MAPS",
              sourceDetail: "Google Places",
            } satisfies BusinessCandidate;
          });
      } catch (e) {
        console.error("[prospecting] places search failed:", e);
        return [];
      }
    },
  };
}
