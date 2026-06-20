import { fetchTimeout } from "./http";
import { store, uid } from "./store";
import { tavilySearch, hasWebSearch, type SearchHit } from "./research";
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
  { re: /lodziarni|lody\b/i, q: '["amenity"="ice_cream"]' },
  { re: /pralni/i, q: '["shop"="laundry"]' },
  { re: /szewc|naprawa\s*obuwia/i, q: '["craft"="shoemaker"]' },
  { re: /krawiec|krawcow|przeróbk/i, q: '["craft"="tailor"]' },
  { re: /tapicer/i, q: '["craft"="upholsterer"]' },
  { re: /[śs]lusarz|dorabianie\s*kluczy/i, q: '["craft"="locksmith"]' },
  { re: /dekarz|pokrycia\s*dach/i, q: '["craft"="roofer"]' },
  { re: /malarz|malowani/i, q: '["craft"="painter"]' },
  { re: /spawacz|spawaln/i, q: '["craft"="welder"]' },
  { re: /piekarz|piekarni/i, q: '["shop"="bakery"]' },
  { re: /mi[ęe]sn|masarni|w[ęe]dlin/i, q: '["shop"="butcher"]' },
  { re: /monastyr|sklep\s*spo[żz]yw|spo[żz]ywcz|sklep\s*ogóln/i, q: '["shop"="convenience"]' },
  { re: /alkohol|monopolow/i, q: '["shop"="alcohol"]' },
  { re: /zegarmistrz|zegark/i, q: '["craft"="watchmaker"]' },
  { re: /pizzeri/i, q: '["amenity"="restaurant"]["cuisine"~"pizza"]' },
];

// Kategorie „biznesowe" do SZEROKIEGO szukania (bez niszy) — nie tylko sklepy/rzemiosło/biura,
// ale też gastronomia, zdrowie, usługi i turystyka. To największa naprawa „nie znajduje jak trzeba".
const BUSINESS_AMENITY = "^(restaurant|cafe|bar|pub|fast_food|dentist|doctors|clinic|pharmacy|veterinary|fuel|bank|cinema|nightclub|car_wash|driving_school|language_school|kindergarten|car_rental|ice_cream)$";
const BROAD_SELECTORS = [
  '["shop"]["name"]',
  '["craft"]["name"]',
  '["office"]["name"]',
  `["amenity"~"${BUSINESS_AMENITY}"]["name"]`,
  '["healthcare"]["name"]',
  '["leisure"~"fitness_centre|sports_centre"]["name"]',
  '["tourism"~"hotel|guest_house|hostel|apartment|motel"]["name"]',
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

/** Buduje zapytanie Overpass dla niszy w bbox. Znana nisza → tag; nieznana → szukanie po NAZWIE
 *  w kategoriach biznesowych; brak niszy → szeroka lista lokalnych firm (gastronomia/zdrowie/usługi/turystyka). */
export function buildOverpassQuery(bbox: [number, number, number, number], niche?: string): string {
  const b = bbox.join(",");
  const tag = nicheToOverpass(niche);
  let sel: string[];
  if (tag) {
    sel = [`nwr${tag}["name"](${b});`];
  } else if (niche?.trim()) {
    // Nieznana nisza (np. „solarium”, „lombard”) → szukaj po nazwie w kategoriach biznesowych.
    const esc = niche.trim().replace(/[.*+?^${}()|[\]\\"\n]/g, " ").trim().slice(0, 40);
    sel = ['["shop"]', '["craft"]', '["office"]', '["amenity"]'].map((s) => `nwr${s}["name"~"${esc}",i](${b});`);
  } else {
    sel = BROAD_SELECTORS.map((s) => `nwr${s}(${b});`);
  }
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

/** Filtry kanałowe — dopasuj leady do sposobu kontaktu (skuteczność kampanii). */
export interface LeadFilters {
  onlyNoWebsite?: boolean; // tylko bez strony www (idealni dla agencji stron)
  onlyWithEmail?: boolean; // tylko z e-mailem (cold-mailing)
  onlyWithPhone?: boolean; // tylko z telefonem (cold-calling)
}

/** Pure: czy lead przechodzi filtry kanałowe. */
export function passesFilters(l: RawLead, f: LeadFilters): boolean {
  if (f.onlyNoWebsite && l.hasWebsite) return false;
  if (f.onlyWithEmail && !l.email) return false;
  if (f.onlyWithPhone && !l.phone) return false;
  return true;
}

/**
 * Pure: ocena „atrakcyjności" leada (0–10). Dla agencji stron najcenniejsi to firmy
 * BEZ strony, z kontaktem (e-mail > telefon) i kompletnymi danymi (adres/godziny).
 */
export function scoreLead(l: RawLead): number {
  let s = 0;
  if (!l.hasWebsite) s += 4;       // brak strony = realny powód do oferty
  if (l.email) s += 3;             // e-mail = wysyłka jednym kliknięciem
  else if (l.phone) s += 2;        // telefon = cold-call
  if (l.address) s += 1;           // pełniejsze dane = lepszy lead w CRM
  if (l.hours) s += 0.5;
  return Math.round(s * 2) / 2;
}

/** Posortuj i odsiej duplikaty surowych leadów wg jakości i filtrów (czysta, testowalna). */
export function rankRawLeads(els: any[], count: number, filters: LeadFilters | boolean = {}): RawLead[] {
  // Wstecznie zgodne: boolean = stary onlyNoWebsite.
  const f: LeadFilters = typeof filters === "boolean" ? { onlyNoWebsite: filters } : filters;
  const seen = new Set<string>();
  const out: RawLead[] = [];
  for (const el of els) {
    const lead = parseElement(el);
    if (!lead) continue;
    if (!passesFilters(lead, f)) continue;
    const key = lead.company.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lead);
    if (out.length >= count * 3) break;
  }
  // Najlepsze leady na górę wg scoreLead (bez strony + kontakt + komplet danych).
  out.sort((a, b) => scoreLead(b) - scoreLead(a));
  return out.slice(0, count);
}

/** Wyszukaj firmy w OSM z filtrami kanałowymi. */
export async function searchOSM(niche: string | undefined, city: string, count = 12, filters: LeadFilters | boolean = {}): Promise<RawLead[]> {
  const geo = await geocode(city);
  if (!geo) return [];
  const els = await overpassQuery(buildOverpassQuery(geo.bbox, niche));
  if (!els) return [];
  return rankRawLeads(els, count, filters);
}

// === Wzbogacanie z sieci (Tavily) — łapie firmy, których nie ma w OpenStreetMap ===

// Katalogi/agregatory — to NIE są strony firm; nie traktuj ich jako „ma stronę".
const DIRECTORY_HOSTS = /(panoramafirm|aleo\.com|pkt\.pl|firmy\.net|gowork|biznesfinder|facebook|instagram|google\.|maps\.|booksy|znanylekarz|oferia|fixly|olx\.|allegro|yelp|tripadvisor|foursquare)/i;

/** Pure: wyłuskaj lead z wyniku wyszukiwania (firma z tytułu, telefon/e-mail z treści, strona z URL). */
export function parseWebLead(hit: SearchHit, niche?: string, city?: string): RawLead | null {
  const title = (hit.title || "").trim();
  if (!title) return null;
  // Nazwa firmy: utnij ogony typu „ - Kraków | Panorama Firm".
  const company = title.split(/[|–—\-–—·:]/)[0].trim().slice(0, 80);
  if (company.length < 2) return null;
  const blob = `${hit.content || ""} ${hit.url || ""}`;
  const email = (blob.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || "").slice(0, 120) || undefined;
  const phoneRaw = blob.match(/(?:\+48\s?)?(?:\d[\s-]?){9}/)?.[0];
  const phone = phoneRaw && phoneRaw.replace(/\D/g, "").length >= 9 ? phoneRaw.trim().slice(0, 40) : undefined;
  const isDirectory = DIRECTORY_HOSTS.test(hit.url || "");
  const website = !isDirectory ? hit.url : undefined;
  // Bez żadnego kontaktu i bez własnej strony lead jest bezużyteczny — odrzuć.
  if (!email && !phone && !website) return null;
  return { company, phone, email, website, address: city, hours: undefined, kind: niche?.trim() || undefined, hasWebsite: !!website };
}

/** Wzbogać wyszukiwanie o wyniki z sieci (Tavily). Pusta lista bez klucza/wyników. */
export async function searchWebLeads(niche: string | undefined, city: string, count = 12): Promise<RawLead[]> {
  if (!hasWebSearch()) return [];
  const q = `${niche?.trim() || "firmy"} ${city} kontakt telefon`;
  const hits = await tavilySearch(q, { maxResults: Math.min(15, count + 5) });
  const out: RawLead[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const lead = parseWebLead(h, niche, city);
    if (!lead) continue;
    const key = lead.company.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lead);
  }
  return out;
}

/** Pure: scal leady z OSM i z sieci, usuwając duplikaty (nazwa/telefon/e-mail). OSM ma pierwszeństwo. */
export function mergeRawLeads(osm: RawLead[], web: RawLead[], count: number): RawLead[] {
  const keysOf = (l: RawLead) => leadKeys({ company: l.company, phone: l.phone, email: l.email });
  const seen = new Set<string>();
  const out: RawLead[] = [];
  for (const l of [...osm, ...web]) {
    const ks = keysOf(l);
    if (ks.some((k) => seen.has(k))) continue;
    for (const k of ks) seen.add(k);
    out.push(l);
  }
  out.sort((a, b) => scoreLead(b) - scoreLead(a));
  return out.slice(0, count);
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

// --- Dedup leadów odporny na warianty nazwy (ten sam biznes, inny zapis) ---
// Poza nazwą firmy dopasowujemy też TELEFON i E-MAIL. Dzięki temu kolejne
// wyszukiwania w tym samym mieście nie zaśmiecają pipeline'u duplikatami
// (np. „Pizza Roma" i „Pizzeria Roma" z tym samym numerem to jeden lead).
export const normName = (s?: string): string => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
export const normPhone = (s?: string): string => {
  const d = String(s || "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : ""; // ostatnie 9 cyfr (PL) — ignoruje prefiks kraju/formatowanie
};
export const normEmail = (s?: string): string => {
  const e = String(s || "").trim().toLowerCase();
  return e.includes("@") ? e : "";
};

/** Klucze tożsamości leada (nazwa/telefon/email) do dedupu. Czysta, testowalna. */
export function leadKeys(l: { company?: string; phone?: string; email?: string; contact?: string }): string[] {
  const keys: string[] = [];
  const n = normName(l.company);
  if (n) keys.push(`n:${n}`);
  for (const cand of [l.phone, l.contact]) {
    if (cand && cand.includes("@")) continue; // contact bywa e-mailem — to nie telefon
    const p = normPhone(cand);
    if (p) { keys.push(`p:${p}`); break; }
  }
  for (const cand of [l.email, l.contact]) {
    const e = normEmail(cand);
    if (e) { keys.push(`e:${e}`); break; }
  }
  return keys;
}

/** Zapisz surowe leady do Pulpitu Sprzedaży (z dedupem nazwa+telefon+email). Zwraca NOWE leady. */
export function saveLeads(raws: RawLead[], niche: string | undefined, city: string): Lead[] {
  const fresh: Lead[] = [];
  const now = Date.now();
  store.setData((d) => {
    const seen = new Set<string>();
    for (const l of d.leads) for (const k of leadKeys(l)) seen.add(k);
    for (const r of raws) {
      const keys = leadKeys(r);
      if (keys.some((k) => seen.has(k))) continue; // duplikat po nazwie, telefonie lub e-mailu
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
      for (const k of keys) seen.add(k); // dedup także WEWNĄTRZ tej partii
      fresh.push(lead);
    }
  });
  return fresh;
}

/** Miasto z geolokalizacji przeglądarki (gdy użytkownik nie poda lokalizacji). */
export function browserCity(): Promise<string | null> {
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
/** Pure: ile leadów szukać — z opcji, potem ustawień, potem 15; ogranicz do 3–50. */
export function resolveLeadCount(optCount?: number, settingCount?: number): number {
  return Math.min(50, Math.max(3, optCount || settingCount || 15));
}

export async function findLeads(opts: {
  niche?: string; location?: string; count?: number;
  onlyNoWebsite?: boolean; onlyWithEmail?: boolean; onlyWithPhone?: boolean;
  useWeb?: boolean; // wzbogać o wyniki z sieci (Tavily), gdy jest klucz
}): Promise<FindResult> {
  const s = store.settings;
  const count = resolveLeadCount(opts.count, s.prospectCount);
  const filters: LeadFilters = { onlyNoWebsite: opts.onlyNoWebsite, onlyWithEmail: opts.onlyWithEmail, onlyWithPhone: opts.onlyWithPhone };
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

  const osm = await searchOSM(niche, city, count, filters);
  // Wzbogacenie z sieci (opcjonalne) — łapie firmy spoza OSM. Filtry stosujemy też do nich.
  let raws = osm;
  if (opts.useWeb) {
    const web = (await searchWebLeads(niche, city, count)).filter((l) => passesFilters(l, filters));
    raws = mergeRawLeads(osm, web, count);
  }
  if (!raws.length) {
    const hint = opts.onlyWithEmail ? " (filtr: tylko z e-mailem — spróbuj bez niego)" : opts.onlyNoWebsite ? " (filtr: tylko bez strony)" : "";
    return { added: 0, found: 0, city, sample: [], addedLeads: [], error: `Nie znalazłem firm dla „${niche || "lokalne firmy"}" w „${city}"${hint}. Spróbuj inną niszę, miasto lub poluzuj filtry.` };
  }
  // Zapamiętaj miasto, by kolejne wyszukiwania działały autonomicznie (bez podawania lokalizacji).
  if (city && city !== s.prospectLocation) store.setSettings({ prospectLocation: city });
  const addedLeads = saveLeads(raws, niche, city);
  return { added: addedLeads.length, found: raws.length, city, sample: raws.slice(0, 5), addedLeads };
}

