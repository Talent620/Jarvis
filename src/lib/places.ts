// Gdzie kupię w pobliżu — wpisujesz, czego potrzebujesz, a JARVIS podpowiada
// MIEJSCA, gdzie to kupisz: najbliżej, oraz „taniej, ale dalej". Dwie warstwy:
//   1) deep-linki do map/wyszukiwarki (działają bez klucza),
//   2) inteligentne zestawienie przez AI z wyszukiwaniem w sieci (lista miejsc
//      z odległością i ceną, posortowana po odległości, z wyróżnieniem kompromisu).
// Czyste funkcje (mapLinks, parsePlaces, normalizePlaces, rankPlaces) — testowalne.

import { resolveProvider } from "./brain";
import { PROVIDERS } from "./providers/registry";
import { getCitations, resetCitations } from "./tools";
import { store } from "./store";
import { toNumber } from "./bargain";

export interface Place {
  name: string;
  address?: string;
  /** Odległość w km od podanej lokalizacji (jeśli znana). */
  distanceKm?: number;
  price?: number;
  currency?: string;
  hours?: string;
  phone?: string;
  url?: string;
  note?: string;
}

export interface PlaceLink {
  name: string;
  url: string;
  icon: string;
}

export interface PlacesResult {
  query: string;
  place: string;
  places: Place[];
  links: PlaceLink[];
  tips: string[];
  citations?: { title: string; url: string }[];
  note?: string;
  error?: string;
}

export interface Coords {
  lat: number;
  lon: number;
}

const enc = (s: string) => encodeURIComponent(s.trim());

/** Deterministyczne linki do map i wyszukiwarki — działają bez klucza AI. */
export function mapLinks(query: string, place?: string, coords?: Coords): PlaceLink[] {
  const q = query.trim();
  if (!q) return [];
  const near = place && place.trim() ? ` ${place.trim()}` : "";
  const gmapQuery = enc(`${q} sklep${near}`);
  const links: PlaceLink[] = [];
  if (coords) {
    links.push({ name: "Mapy Google (tu)", icon: "🗺", url: `https://www.google.com/maps/search/${enc(q)}/@${coords.lat},${coords.lon},13z` });
  }
  links.push(
    { name: "Mapy Google", icon: "🗺", url: `https://www.google.com/maps/search/?api=1&query=${gmapQuery}` },
    { name: "Szukaj w Google", icon: "🔎", url: `https://www.google.com/search?q=${enc(`gdzie kupić ${q}${near}`)}` },
    { name: "Mapy Apple", icon: "🍏", url: `https://maps.apple.com/?q=${gmapQuery}` },
  );
  return links;
}

/** System prompt — wyszukiwarka lokalnych miejsc zakupu; wymusza czysty JSON. */
export function buildPlacesPrompt(place: string): string {
  return [
    `Jesteś lokalnym przewodnikiem zakupowym. Użytkownik podaje, czego potrzebuje. Znajdź konkretne MIEJSCA (sklepy, punkty, hurtownie), gdzie kupi to w pobliżu lokalizacji: ${place}.`,
    "ZASADY:",
    "- Użyj wyszukiwarki internetowej i map. Podawaj realne, istniejące miejsca z okolicy.",
    "- Dla każdego miejsca podaj: nazwę, adres, przybliżoną odległość w km od lokalizacji, cenę produktu (jeśli znana), godziny otwarcia i telefon (jeśli są), oraz link.",
    "- Pokaż kompromis: najbliższy punkt ORAZ tańszy, choć dalszy — żeby użytkownik wybrał.",
    "- Zwróć WYŁĄCZNIE poprawny JSON (bez markdown, bez komentarzy) w formacie:",
    '{"place":"ustalona lokalizacja","places":[{"name":"...","address":"...","distanceKm":2.5,"price":199,"currency":"PLN","hours":"9-18","phone":"...","url":"https://...","note":"krótko"}],"tips":["rada"]}',
    '- "distanceKm" i "price" to liczby (bez jednostek). "distanceKm" mniejsze = bliżej.',
    "- Do 12 miejsc, najbliższe pierwsze.",
    '- Jeśli nic nie znajdziesz, zwróć "places": [].',
  ].join("\n");
}

/** Wyłuskaj i sparsuj JSON z odpowiedzi modelu (odporne na otoczkę/markdown). */
export function parsePlaces(raw: string): { place?: string; places: Place[]; tips: string[] } | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let data: any;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  return {
    place: typeof data?.place === "string" ? data.place : undefined,
    places: normalizePlaces(data?.places),
    tips: Array.isArray(data?.tips) ? data.tips.filter((t: unknown) => typeof t === "string").slice(0, 5) : [],
  };
}

/** Oczyść/zwaliduj listę miejsc — odrzuć wpisy bez nazwy. */
export function normalizePlaces(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return [];
  const out: Place[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const name = String((p as any).name || "").trim();
    if (!name) continue;
    const price = toNumber((p as any).price);
    const dist = toNumber((p as any).distanceKm);
    const url = typeof (p as any).url === "string" && /^https?:\/\//i.test((p as any).url) ? (p as any).url.trim() : undefined;
    out.push({
      name,
      address: str((p as any).address),
      distanceKm: dist > 0 ? dist : undefined,
      price: price > 0 ? price : undefined,
      currency: str((p as any).currency) || (price > 0 ? "PLN" : undefined),
      hours: str((p as any).hours),
      phone: str((p as any).phone),
      url,
      note: str((p as any).note),
    });
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export interface RankedPlaces {
  byDistance: Place[];
  nearest: Place | null;
  /** Najtańsze miejsce różne od najbliższego (zwykle „taniej, ale dalej"). */
  cheaperFar: Place | null;
}

/** Posortuj po odległości i wskaż najbliższe oraz najtańsze (kompromis). */
export function rankPlaces(places: Place[]): RankedPlaces {
  const byDistance = [...places].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  const nearest = byDistance[0] || null;
  const priced = places.filter((p) => p.price != null && p.price > 0);
  let cheapest: Place | null = null;
  for (const p of priced) if (!cheapest || p.price! < cheapest.price!) cheapest = p;
  const cheaperFar = cheapest && cheapest !== nearest ? cheapest : null;
  return { byDistance, nearest, cheaperFar };
}

/** Pobierz lokalizację z przeglądarki (jeśli użytkownik pozwoli). */
export function myCoords(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 6000 },
    );
  });
}

/**
 * Znajdź miejsca zakupu w pobliżu. Zawsze zwraca linki do map; gdy jest klucz AI
 * z wyszukiwaniem w sieci, dokłada listę miejsc z odległością i ceną.
 */
export async function findPlaces(query: string, place: string, coords?: Coords): Promise<PlacesResult> {
  const clean = query.trim();
  const where = place.trim() || (coords ? `współrzędne ${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}` : "Polska");
  const links = mapLinks(clean, place, coords);
  if (!clean) return { query: "", place: where, places: [], links, tips: [] };

  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) {
    return { query: clean, place: where, places: [], links, tips: [], note: "no-ai" };
  }

  resetCitations();
  try {
    const reply = await PROVIDERS[r.provider].impl({
      system: buildPlacesPrompt(where),
      webSearch: true,
      tools: [],
      history: [{ role: "user", content: `Gdzie kupię w pobliżu: ${clean}` }],
      apiKey: r.apiKey,
      model: r.model,
      proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    });
    const parsed = parsePlaces(reply.text || "");
    return {
      query: clean,
      place: parsed?.place || where,
      places: parsed?.places ?? [],
      links,
      tips: parsed?.tips ?? [],
      citations: getCitations(),
    };
  } catch (e) {
    return { query: clean, place: where, places: [], links, tips: [], error: e instanceof Error ? e.message : String(e) };
  }
}
