import { fetchTimeout } from "./http";
import { store, uid } from "./store";
import type { Lead } from "../types";

// === Silnik wyszukiwania leadów (darmowy, bez kluczy) ===
// Źródło: OpenStreetMap przez Overpass API — realne firmy lokalne z nazwą,
// TELEFONEM, stroną i adresem. Bez żadnego klucza, CORS OK, 10k zapytań/dzień.
// Killer-feature dla agencji stron: filtr „tylko firmy BEZ strony www" — to
// idealni klienci. Tavily (jeśli jest klucz) dokłada wyniki z sieci.

const OVERPASS = "https://overpass-api.de/api/interpreter";
const NOMINATIM = "https://nominatim.openstreetmap.org";

export interface RawLead {
  company: string;
  phone?: string;
  website?: string;
  address?: string;
  kind?: string;
  hasWebsite: boolean;
}

// Najczęstsze polskie nisze → tagi OSM (precyzyjne, szybkie zapytanie).
const NICHE_TAGS: { re: RegExp; q: string }[] = [
  { re: /fryzjer|barber|salon\s*fryz/i, q: '["shop"="hairdresser"]' },
  { re: /kosmetyczk|uroda|beauty|paznok|brwi|rzęs/i, q: '["shop"="beauty"]' },
  { re: /restaurac|restaur/i, q: '["amenity"="restaurant"]' },
  { re: /kawiarni|cafe|kawa/i, q: '["amenity"="cafe"]' },
  { re: /\bbar\b|pub|piwo/i, q: '["amenity"="bar"]' },
  { re: /dentyst|stomatolog/i, q: '["amenity"="dentist"]' },
  { re: /lekarz|przychodni|doctor|gabinet\s*lek/i, q: '["amenity"="doctors"]' },
  { re: /warsztat|mechanik|samochod|auto\s*serwis|naprawa\s*aut/i, q: '["shop"="car_repair"]' },
  { re: /myjni/i, q: '["amenity"="car_wash"]' },
  { re: /si[łl]owni|fitness|gym/i, q: '["leisure"="fitness_centre"]' },
  { re: /hotel|nocleg|pensjonat/i, q: '["tourism"="hotel"]' },
  { re: /kwiaciar|florist|kwiat/i, q: '["shop"="florist"]' },
  { re: /piekarni|cukierni|bakery/i, q: '["shop"="bakery"]' },
  { re: /aptek|pharmac/i, q: '["amenity"="pharmacy"]' },
  { re: /weterynar|vet/i, q: '["amenity"="veterinary"]' },
  { re: /prawnik|kancelar|adwokat|radca/i, q: '["office"="lawyer"]' },
  { re: /ksi[ęe]gow|rachunkow|accountant/i, q: '["office"="accountant"]' },
  { re: /nieruchomo|estate|po[śs]rednik/i, q: '["office"="estate_agent"]' },
  { re: /elektryk/i, q: '["craft"="electrician"]' },
  { re: /hydraulik|instalac/i, q: '["craft"="plumber"]' },
  { re: /stolarz|meble/i, q: '["craft"="carpenter"]' },
  { re: /fotograf|photo/i, q: '["craft"="photographer"]' },
  { re: /budowl|remont|wykończ/i, q: '["craft"="builder"]' },
  { re: /optyk/i, q: '["shop"="optician"]' },
  { re: /tatua|tattoo/i, q: '["shop"="tattoo"]' },
];

/** Dobierz filtr OSM dla niszy (lub null → szerokie wyszukiwanie wszystkich firm). */
export function nicheToOverpass(niche?: string): string | null {
  if (!niche?.trim()) return null;
  return NICHE_TAGS.find((n) => n.re.test(niche))?.q || null;
}

/** Bounding box z Nominatim (lat/lon strings) → krotka Overpass (S,W,N,E). */
export function toOverpassBbox(nominatimBB: string[]): [number, number, number, number] | null {
  if (!nominatimBB || nominatimBB.length !== 4) return null;
  const [minLat, maxLat, minLon, maxLon] = nominatimBB.map(Number);
  if ([minLat, maxLat, minLon, maxLon].some((n) => !isFinite(n))) return null;
  return [minLat, minLon, maxLat, maxLon];
}

/** Element OSM → surowy lead (lub null, gdy brak nazwy). Czysta, testowalna. */
export function parseElement(el: any): RawLead | null {
  const t = el?.tags;
  if (!t?.name) return null;
  const phone = t.phone || t["contact:phone"] || t["contact:mobile"] || undefined;
  const website = t.website || t["contact:website"] || t.url || undefined;
  const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
  const address = [street, t["addr:city"]].filter(Boolean).join(", ") || undefined;
  const kind = t.shop || t.craft || t.office || t.amenity || t.leisure || t.tourism || undefined;
  return { company: String(t.name).slice(0, 80), phone, website, address, kind, hasWebsite: !!website };
}

async function geocode(city: string): Promise<{ bbox: [number, number, number, number]; name: string } | null> {
  try {
    const res = await fetchTimeout(`${NOMINATIM}/search?city=${encodeURIComponent(city)}&format=json&limit=1`, {}, 9000);
    const d = await res.json().catch(() => null);
    const r = d?.[0];
    const bbox = r ? toOverpassBbox(r.boundingbox) : null;
    return bbox ? { bbox, name: r.display_name?.split(",")[0] || city } : null;
  } catch {
    return null;
  }
}

/** Buduje zapytanie Overpass dla niszy w bbox (lub szerokie, gdy brak niszy). */
export function buildOverpassQuery(bbox: [number, number, number, number], niche?: string): string {
  const b = bbox.join(",");
  const tag = nicheToOverpass(niche);
  const sel = tag
    ? [`nwr${tag}["name"](${b});`]
    : ['["shop"]', '["craft"]', '["office"]'].map((s) => `nwr${s}["name"](${b});`);
  return `[out:json][timeout:25];(${sel.join("")});out center 250;`;
}

/** Wyszukaj firmy w OSM. `onlyNoWebsite` → tylko bez strony (idealni dla agencji). */
export async function searchOSM(niche: string | undefined, city: string, count = 12, onlyNoWebsite = false): Promise<RawLead[]> {
  const geo = await geocode(city);
  if (!geo) return [];
  try {
    const res = await fetchTimeout(OVERPASS, { method: "POST", body: buildOverpassQuery(geo.bbox, niche) }, 30000);
    const d = await res.json().catch(() => null);
    const els: any[] = d?.elements || [];
    const seen = new Set<string>();
    const out: RawLead[] = [];
    for (const el of els) {
      const lead = parseElement(el);
      if (!lead) continue;
      if (onlyNoWebsite && lead.hasWebsite) continue;
      const key = lead.company.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Priorytet: firmy z telefonem (da się dzwonić) i bez strony (potrzebują jej).
      out.push(lead);
      if (out.length >= count * 3) break;
    }
    // Sortuj: bez strony + z telefonem na górę (najlepsze leady dla agencji stron).
    out.sort((a, b) => Number(!a.hasWebsite && !!a.phone) - Number(!b.hasWebsite && !!b.phone)).reverse();
    return out.slice(0, count);
  } catch {
    return [];
  }
}

/** Reverse-geocode współrzędnych → miasto (gdy użytkownik nie poda lokalizacji). */
export async function cityFromCoords(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetchTimeout(`${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=json`, {}, 9000);
    const d = await res.json().catch(() => null);
    const a = d?.address;
    return a?.city || a?.town || a?.village || a?.municipality || a?.county || null;
  } catch {
    return null;
  }
}

/** Zapisz surowe leady do Pulpitu Sprzedaży (z dedupem). Zwraca NOWE leady. */
export function saveLeads(raws: RawLead[], niche: string | undefined, city: string): Lead[] {
  const fresh: Lead[] = [];
  const now = Date.now();
  store.setData((d) => {
    for (const r of raws) {
      if (d.leads.some((l) => l.company.toLowerCase() === r.company.toLowerCase())) continue;
      const note = !r.hasWebsite ? "Brak strony www — idealny lead dla agencji stron." : undefined;
      const lead: Lead = {
        id: uid(),
        company: r.company,
        url: r.website,
        contact: r.phone,
        niche: niche?.trim() || r.kind,
        location: city,
        note,
        status: "new",
        createdAt: now,
        updatedAt: now,
      };
      d.leads.unshift(lead);
      fresh.push(lead);
    }
  });
  return fresh;
}

/** Miasto z geolokalizacji przeglądarki (gdy użytkownik nie poda lokalizacji). */
function browserCity(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => resolve(await cityFromCoords(pos.coords.latitude, pos.coords.longitude)),
      () => resolve(null),
      { timeout: 7000 },
    );
  });
}

export interface FindResult {
  added: number;
  found: number;
  city?: string;
  sample: RawLead[];
  addedLeads: Lead[];
  error?: string;
}

/**
 * Główne wyszukiwanie leadów. Nisza i lokalizacja są OPCJONALNE:
 *  - brak lokalizacji → próbuje geolokalizacji,
 *  - brak niszy → szuka wszystkich lokalnych firm (priorytet: bez strony www).
 * Znalezione leady od razu zapisuje do Pulpitu Sprzedaży.
 */
export async function findLeads(opts: { niche?: string; location?: string; count?: number; onlyNoWebsite?: boolean }): Promise<FindResult> {
  const count = Math.min(30, Math.max(3, opts.count || 12));
  let city = opts.location?.trim() || "";
  if (!city) city = (await browserCity()) || "";
  if (!city) return { added: 0, found: 0, sample: [], addedLeads: [], error: "Podaj miasto (np. Kraków) albo zezwól na lokalizację — wtedy znajdę firmy z okolicy." };

  const raws = await searchOSM(opts.niche, city, count, !!opts.onlyNoWebsite);
  if (!raws.length) {
    return { added: 0, found: 0, city, sample: [], addedLeads: [], error: `Nie znalazłem firm dla „${opts.niche || "lokalne firmy"}" w „${city}". Spróbuj inną niszę lub miasto.` };
  }
  const addedLeads = saveLeads(raws, opts.niche, city);
  return { added: addedLeads.length, found: raws.length, city, sample: raws.slice(0, 5), addedLeads };
}

