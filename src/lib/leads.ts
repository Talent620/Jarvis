import { fetchTimeout } from "./http";
import { store, uid } from "./store";
import type { Lead } from "../types";

// === Silnik wyszukiwania leadów (darmowy, bez kluczy) ===
// Źródło: OpenStreetMap przez Overpass API — realne firmy lokalne z nazwą,
// TELEFONEM, stroną i adresem. Bez żadnego klucza, CORS OK, 10k zapytań/dzień.
// Killer-feature dla agencji stron: filtr „tylko firmy BEZ strony www" — to
// idealni klienci. Tavily (jeśli jest klucz) dokłada wyniki z sieci.

// Zapasowe serwery Overpass — gdy główny pada lub limituje, próbujemy kolejnych.
// „Super sprawne": szukanie nie poddaje się po jednym błędzie.
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];
const NOMINATIM = "https://nominatim.openstreetmap.org";

export interface RawLead {
  company: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  hours?: string;
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
  { re: /pizz/i, q: '["cuisine"~"pizza"]' },
  { re: /kebab/i, q: '["cuisine"~"kebab"]' },
  { re: /fast\s*food|burger/i, q: '["amenity"="fast_food"]' },
  { re: /masa[żz]|spa\b/i, q: '["shop"="massage"]' },
  { re: /fizjo|rehabilitac/i, q: '["healthcare"="physiotherapist"]' },
  { re: /ubezpiecz/i, q: '["office"="insurance"]' },
  { re: /biuro\s*podr[óo][żz]|travel/i, q: '["shop"="travel_agency"]' },
  { re: /szko[łl]a\s*j[ęe]zyk|j[ęe]zykow/i, q: '["amenity"="language_school"]' },
  { re: /naukajazdy|nauka\s*jazdy|o[śs]rodek\s*szkolenia\s*kierowc/i, q: '["amenity"="driving_school"]' },
  { re: /komputer|serwis\s*(it|pc)|informatyc/i, q: '["shop"="computer"]' },
  { re: /telefon[óo]w|gsm|serwis\s*telefon/i, q: '["shop"="mobile_phone"]' },
  { re: /jubiler|z[łl]otnik|bi[żz]uteri/i, q: '["shop"="jewelry"]' },
  { re: /odzie[żz]|ubrani|butik|moda/i, q: '["shop"="clothes"]' },
  { re: /zoologiczn|karma|pet\s*shop/i, q: '["shop"="pet"]' },
  { re: /rowerow|rower/i, q: '["shop"="bicycle"]' },
  { re: /ogrodnic|ogrod[óo]w/i, q: '["shop"="garden_centre"]' },
  { re: /przedszkol|[żz][łl]obek/i, q: '["amenity"="kindergarten"]' },
  { re: /ksero|drukarni|poligraf/i, q: '["shop"="copyshop"]' },
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
  // Tagi OSM są niezaufane — utnij każde pole do sensownej długości (anty-bloat store/CRM).
  const cap = (v: unknown, n: number) => (v ? String(v).slice(0, n) : undefined);
  const phone = cap(t.phone || t["contact:phone"] || t["contact:mobile"], 40);
  const email = cap(t.email || t["contact:email"], 120);
  const website = cap(t.website || t["contact:website"] || t.url, 200);
  const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
  const address = cap([street, t["addr:city"]].filter(Boolean).join(", "), 160);
  const hours = cap(t.opening_hours, 120);
  const kind = cap(t.shop || t.craft || t.office || t.amenity || t.leisure || t.tourism, 40);
  return { company: String(t.name).slice(0, 80), phone, email, website, address, hours, kind, hasWebsite: !!website };
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

/** Odpytaj Overpass z automatycznym przełączaniem na zapasowe serwery. */
async function overpassQuery(query: string): Promise<any[] | null> {
  for (const url of OVERPASS_MIRRORS) {
    try {
      // 12s/mirror (Overpass i tak ma [timeout:25] po stronie serwera) — 4×30s = ~2 min
      // zawieszenia UI przy wszystkich wiszących serwerach było za dużo.
      const res = await fetchTimeout(url, { method: "POST", body: query }, 12000);
      if (!res.ok) continue; // 429/504 → następny serwer
      const d = await res.json().catch(() => null);
      if (d?.elements) return d.elements as any[];
    } catch {
      /* timeout/sieć — próbuj kolejny serwer */
    }
  }
  return null;
}

/** Posortuj i odsiej duplikaty surowych leadów (czysta, testowalna). */
export function rankRawLeads(els: any[], count: number, onlyNoWebsite: boolean): RawLead[] {
  const seen = new Set<string>();
  const out: RawLead[] = [];
  for (const el of els) {
    const lead = parseElement(el);
    if (!lead) continue;
    if (onlyNoWebsite && lead.hasWebsite) continue;
    const key = lead.company.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lead);
    if (out.length >= count * 3) break;
  }
  // Najlepsze leady dla agencji stron na górę: bez strony + z telefonem,
  // potem bez strony, potem z telefonem. Stabilny scoring „atrakcyjności".
  const rank = (l: RawLead) => (l.hasWebsite ? 0 : 2) + (l.phone ? 1 : 0);
  out.sort((a, b) => rank(b) - rank(a));
  return out.slice(0, count);
}

/** Wyszukaj firmy w OSM. `onlyNoWebsite` → tylko bez strony (idealni dla agencji). */
export async function searchOSM(niche: string | undefined, city: string, count = 12, onlyNoWebsite = false): Promise<RawLead[]> {
  const geo = await geocode(city);
  if (!geo) return [];
  const els = await overpassQuery(buildOverpassQuery(geo.bbox, niche));
  if (!els) return [];
  return rankRawLeads(els, count, onlyNoWebsite);
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
        contact: r.phone || r.email,
        email: r.email,
        address: r.address,
        hours: r.hours,
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
  const s = store.settings;
  // AUTONOMIA: nisza opcjonalna — podana → zapisana w ustawieniach → pusta (OSM szuka szeroko
  // wszystkich lokalnych firm). Bez niszy NIE blokujemy wyszukiwania.
  const niche = opts.niche?.trim() || s.prospectNiche?.trim() || undefined;
  // Lokalizacja: podana → zapamiętana w ustawieniach → geolokalizacja. Pierwsza, która zadziała.
  let city = opts.location?.trim() || s.prospectLocation?.trim() || "";
  if (!city) city = (await browserCity()) || "";
  if (!city)
    return {
      added: 0,
      found: 0,
      sample: [],
      addedLeads: [],
      error:
        "Nie wiem jeszcze, gdzie szukać. Podaj miasto raz (np. „znajdź leady w Krakowie”) albo zezwól na lokalizację — zapamiętam je i od następnego razu znajdę leady sam, bez pytania.",
    };

  const raws = await searchOSM(niche, city, count, !!opts.onlyNoWebsite);
  if (!raws.length) {
    return { added: 0, found: 0, city, sample: [], addedLeads: [], error: `Nie znalazłem firm dla „${niche || "lokalne firmy"}" w „${city}". Spróbuj inną niszę lub miasto.` };
  }
  // Zapamiętaj miasto, by kolejne wyszukiwania działały autonomicznie (bez podawania lokalizacji).
  if (city && city !== s.prospectLocation) store.setSettings({ prospectLocation: city });
  const addedLeads = saveLeads(raws, niche, city);
  return { added: addedLeads.length, found: raws.length, city, sample: raws.slice(0, 5), addedLeads };
}

