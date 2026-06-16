import type { BusinessCandidate, BusinessProvider, BusinessQuery } from "./types";

const NAME_STEMS = [
  "Pod Lipą", "U Marka", "Złote Nożyczki", "Perfekt", "Maxi", "Bella", "Centrum",
  "Express", "Premium", "Mistrz", "Atut", "Omega", "Family", "Top", "Aspekt",
];
const STREETS = [
  "ul. Długa 12", "ul. Polna 3", "al. Niepodległości 45", "ul. Ogrodowa 8",
  "ul. Kwiatowa 21", "ul. Słoneczna 5", "ul. Rynek 14", "ul. Leśna 30",
  "ul. Szkolna 7", "ul. Krótka 2",
];
const WEAK_SITES = [
  "http://www.{slug}.republika.pl",
  "http://{slug}.com.pl",
  "https://www.facebook.com/{slug}",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20);
}

function pick<T>(arr: readonly T[], seed: number): T {
  return arr[seed % arr.length];
}

/**
 * Deterministic synthetic Polish local businesses so the Lead Finder works
 * end-to-end with no API keys (offline / demo). Mirrors what Google Places
 * returns: ~60% have no website, some have only a weak site or a Facebook page.
 */
export const mockBusinessProvider: BusinessProvider = {
  name: "sample",
  live: false,
  async search(q: BusinessQuery): Promise<BusinessCandidate[]> {
    const out: BusinessCandidate[] = [];
    const base = hash(`${q.category}|${q.city}`);
    const count = Math.min(q.limit + 6, 24);

    for (let i = 0; i < count; i++) {
      const seed = base + i * 7919;
      const stem = pick(NAME_STEMS, seed);
      const name = `${q.category.charAt(0).toUpperCase()}${q.category.slice(1)} ${stem}`;
      const slug = slugify(`${stem}${q.category}`);
      const bucket = seed % 10; // 0-5 no site · 6-7 weak site · 8-9 decent site
      const hasRealSite = bucket >= 8;
      const weakSite = bucket === 6 || bucket === 7;
      const website = hasRealSite
        ? `https://www.${slug}.pl`
        : weakSite
          ? pick(WEAK_SITES, seed).replace("{slug}", slug)
          : null;
      const isSocialOnly = website?.includes("facebook.com") ?? false;
      const rating = 3 + ((seed >> 3) % 21) / 10; // 3.0 – 5.0
      const reviews = (seed >> 5) % 120;

      const signals: string[] = [];
      if (!website) signals.push("No website — needs one");
      else if (isSocialOnly) signals.push("Only a social profile, no real site");
      else if (weakSite) signals.push("Outdated website (no HTTPS / legacy host)");
      if (reviews < 10) signals.push("Few Google reviews");
      if (rating < 4) signals.push(`Rating only ${rating.toFixed(1)}★`);

      out.push({
        name,
        phone: `+48 ${500 + (seed % 300)} ${String(100 + ((seed >> 2) % 900))} ${String(
          100 + ((seed >> 4) % 900),
        )}`,
        website,
        hasWebsite: Boolean(website) && !isSocialOnly,
        address: `${pick(STREETS, seed)}, ${q.city}`,
        city: q.city,
        category: q.category,
        rating: Math.round(rating * 10) / 10,
        reviewCount: reviews,
        mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(`${name} ${q.city}`)}`,
        signals,
        source: "GOOGLE_MAPS",
        sourceDetail: "Sample data",
      });
    }
    return out;
  },
};
