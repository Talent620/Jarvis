// === Google Places jako drugie źródło leadów (googlePlaces) ===
// Obok OpenStreetMap. Zgodnie z polityką Google: trwale przechowujemy TYLKO placeId (stabilny
// identyfikator) — resztę traktujemy jako do odświeżenia (persistencePolicy "id_only" ustawia już
// leadCandidates dla źródła google_places). Fetch jest WSTRZYKIWANY, więc w testach mockujemy płatne
// API (żadnych realnych zapytań). Parser jest czysty. S9-safe (bez /u, \p, lookbehind).

import { normalizeCandidate, type LeadCandidate } from "./leadCandidates";

export interface GooglePlace {
  placeId: string;
  name: string;
  address?: string;
  phone?: string;
  website?: string;
}

const str = (x: unknown): string | undefined => {
  const s = typeof x === "string" ? x.trim() : "";
  return s || undefined;
};

/**
 * Pure: sparsuj odpowiedź Places API. Obsługuje NOWE API v1 (`places[]`: id, displayName.text,
 * formattedAddress, websiteUri, nationalPhoneNumber) oraz starsze (`results[]`: place_id, name,
 * formatted_address, website, formatted_phone_number). Zwraca tylko wpisy z placeId i nazwą.
 */
export function parseGooglePlaces(json: unknown): GooglePlace[] {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const out: GooglePlace[] = [];

  const v1 = Array.isArray(j.places) ? (j.places as Record<string, unknown>[]) : [];
  for (const p of v1) {
    const placeId = str(p.id);
    const name = str((p.displayName as { text?: string })?.text) || str(p.name);
    if (!placeId || !name) continue;
    out.push({ placeId, name, address: str(p.formattedAddress), phone: str(p.nationalPhoneNumber), website: str(p.websiteUri) });
  }

  const legacy = Array.isArray(j.results) ? (j.results as Record<string, unknown>[]) : [];
  for (const p of legacy) {
    const placeId = str(p.place_id);
    const name = str(p.name);
    if (!placeId || !name) continue;
    out.push({ placeId, name, address: str(p.formatted_address ?? p.vicinity), phone: str(p.formatted_phone_number), website: str(p.website) });
  }

  // Dedup po placeId (nowe API ma pierwszeństwo — wchodzi pierwsze).
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.placeId) ? false : (seen.add(p.placeId), true)));
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Wyszukaj firmy w Google Places (Text Search, nowe API v1). Fetch wstrzykiwany (testy mockują).
 * Brak klucza → pusta lista (nie udajemy wyników). Błąd HTTP (np. 429) → rzuca (obsługa u wołającego).
 */
export async function searchGooglePlaces(query: string, apiKey: string, fetchImpl: FetchLike = fetch): Promise<GooglePlace[]> {
  const q = (query || "").trim();
  if (!apiKey || !q) return [];
  const res = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber",
    },
    body: JSON.stringify({ textQuery: q }),
  });
  if (!res.ok) throw Object.assign(new Error(`Places API ${res.status}`), { status: res.status });
  return parseGooglePlaces(await res.json());
}

/** Pure: zmapuj miejsca na kandydatów. placeId → sourceId (stabilny), zgodnie z polityką Google. */
export function googlePlacesToCandidates(places: GooglePlace[], now: number): LeadCandidate[] {
  return (places || []).map((p) =>
    normalizeCandidate(
      { company: p.name, phone: p.phone, website: p.website, address: p.address, hasWebsite: !!p.website },
      { source: "google_places", now, sourceId: p.placeId, sourceUrl: p.website },
    ),
  );
}
