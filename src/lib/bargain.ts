// Łowca Okazji — znajduje przedmiot (nazwa, model lub numer części) NAJTANIEJ,
// osobno wśród NOWYCH i UŻYWANYCH. Dwie warstwy:
//   1) deep-linki do serwisów już posortowane „od najtańszych" (działa bez klucza),
//   2) inteligentna agregacja przez AI z wyszukiwaniem w sieci (jedna lista + mediana
//      + strażnik oszustw).
// Czyste funkcje (parsowanie/ranking/linki) — w pełni testowalne.

import { resolveProvider, askModel } from "./brain";
import { getCitations, resetCitations } from "./tools";

export type Condition = "new" | "used";
export type DealFlag = "scam" | "deal" | "fair" | "high";

export interface Offer {
  title: string;
  price: number;
  currency: string;
  condition: Condition;
  source: string;
  url: string;
  note?: string;
}

export interface MarketLink {
  name: string;
  url: string;
  kind: Condition | "all";
  icon: string;
}

export interface BargainResult {
  query: string;
  normalized?: string;
  currency: string;
  offers: Offer[];
  links: MarketLink[];
  tips: string[];
  citations?: { title: string; url: string }[];
  /** "no-ai" gdy brak klucza (pokazujemy same deep-linki), albo treść błędu. */
  note?: string;
  error?: string;
}

export interface Ranked {
  sorted: Offer[];
  cheapestNew: Offer | null;
  cheapestUsed: Offer | null;
  median: number;
}

/** Zakoduj zapytanie do query-stringa (spacje → +/%20). */
function enc(q: string): string {
  return encodeURIComponent(q.trim());
}

/** Wariant OLX: w ścieżce spacje zamieniane są na myślniki. */
function olxSlug(q: string): string {
  return encodeURIComponent(q.trim().replace(/\s+/g, "-"));
}

/**
 * Gotowe linki do serwisów — każdy ustawiony na sortowanie „od najtańszych",
 * z filtrem nowe/używane tam, gdzie serwis to wspiera. Działa bez AI.
 */
export function marketLinks(query: string): MarketLink[] {
  const q = enc(query);
  if (!query.trim()) return [];
  return [
    // UŻYWANE
    { name: "OLX", icon: "📦", kind: "used", url: `https://www.olx.pl/oferty/q-${olxSlug(query)}/?search%5Border%5D=filter_float_price:asc` },
    { name: "Vinted", icon: "👕", kind: "used", url: `https://www.vinted.pl/catalog?search_text=${q}&order=price_low_to_high` },
    { name: "eBay (używane)", icon: "🌍", kind: "used", url: `https://www.ebay.pl/sch/i.html?_nkw=${q}&_sop=15&LH_ItemCondition=3000` },
    { name: "Allegro (używane)", icon: "🅰", kind: "used", url: `https://allegro.pl/listing?string=${q}&stan=u%C5%BCywane&order=p` },
    { name: "Otomoto części", icon: "🚗", kind: "used", url: `https://www.otomoto.pl/czesci/q-${olxSlug(query)}/?search%5Border%5D=filter_float_price:asc` },
    // NOWE
    { name: "Allegro (nowe)", icon: "🅰", kind: "new", url: `https://allegro.pl/listing?string=${q}&stan=nowe&order=p` },
    { name: "Amazon", icon: "🛒", kind: "new", url: `https://www.amazon.pl/s?k=${q}&s=price-asc-rank` },
    { name: "Ceneo", icon: "💹", kind: "new", url: `https://www.ceneo.pl/;szukaj-${q}` },
    // ZAGRANICA (często taniej) + porównywarki
    { name: "eBay.de 🇩🇪", icon: "🌍", kind: "all", url: `https://www.ebay.de/sch/i.html?_nkw=${q}&_sop=15` },
    { name: "Amazon.de 🇩🇪", icon: "🌍", kind: "all", url: `https://www.amazon.de/s?k=${q}&s=price-asc-rank` },
    { name: "Google Zakupy", icon: "🔎", kind: "all", url: `https://www.google.com/search?tbm=shop&q=${q}` },
  ];
}

/** System prompt łowcy okazji — wymusza czysty JSON z ofertami. */
export function buildBargainPrompt(region = "Polska"): string {
  return [
    `Jesteś łowcą okazji. Użytkownik podaje przedmiot (nazwę, model lub numer części). Znajdź NAJTAŃSZE realne oferty — osobno NOWE i UŻYWANE — w regionie: ${region}.`,
    "ZASADY:",
    "- Użyj wyszukiwarki internetowej. Sprawdź popularne serwisy: Allegro, OLX, Vinted, eBay, Amazon, Ceneo, Google Zakupy.",
    "- Gdy to część samochodowa (np. „lampa do Golfa”), sprawdź też Otomoto Części, iParts i motoryzacyjne kategorie Allegro/OLX.",
    "- Rozważ oferty zagraniczne (eBay.de, Amazon.de), jeśli realnie wychodzą taniej z wysyłką do Polski — zaznacz to w „note”.",
    "- Bierz realne, aktualne oferty z ceną i bezpośrednim linkiem.",
    "- Zwróć WYŁĄCZNIE poprawny JSON (bez markdown, bez komentarzy) w formacie:",
    '{"normalized":"co to za przedmiot","currency":"PLN","offers":[{"title":"...","price":199,"currency":"PLN","condition":"new","source":"Allegro","url":"https://...","note":"krótko, opcjonalnie"}],"tips":["krótka rada zakupowa"]}',
    '- "price" to sama liczba (bez waluty, bez spacji i bez separatora tysięcy).',
    '- "condition" to dokładnie "new" albo "used".',
    "- Do 12 ofert, najtańsze pierwsze, mieszaj nowe i używane.",
    '- Gdy oferta wygląda na zbyt tanią/podejrzaną, napisz to w "note" (ryzyko oszustwa).',
    '- Jeśli nic nie znajdziesz, zwróć "offers": [].',
  ].join("\n");
}

/** Wyłuskaj i sparsuj obiekt JSON z odpowiedzi modelu (odporne na otoczkę/markdown). */
export function parseBargain(raw: string): { normalized?: string; currency?: string; offers: Offer[]; tips: string[] } | null {
  if (!raw) return null;
  let text = raw.trim();
  // Zdejmij ogrodzenie ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Wytnij od pierwszego { do ostatniego }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let data: any;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const offers = normalizeOffers(data?.offers);
  const tips = Array.isArray(data?.tips) ? data.tips.filter((t: unknown) => typeof t === "string").slice(0, 5) : [];
  return {
    normalized: typeof data?.normalized === "string" ? data.normalized : undefined,
    currency: typeof data?.currency === "string" ? data.currency : undefined,
    offers,
    tips,
  };
}

/** Oczyść/zwaliduj listę ofert z modelu — odrzuć wpisy bez ceny lub linku. */
export function normalizeOffers(raw: unknown): Offer[] {
  if (!Array.isArray(raw)) return [];
  const out: Offer[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const price = toNumber((o as any).price);
    const url = typeof (o as any).url === "string" ? (o as any).url.trim() : "";
    if (!(price > 0) || !/^https?:\/\//i.test(url)) continue;
    const condition: Condition = (o as any).condition === "used" ? "used" : "new";
    out.push({
      title: String((o as any).title || "").trim() || "(bez nazwy)",
      price,
      currency: String((o as any).currency || "PLN").trim() || "PLN",
      condition,
      source: String((o as any).source || "").trim() || hostOf(url),
      url,
      note: typeof (o as any).note === "string" && (o as any).note.trim() ? (o as any).note.trim() : undefined,
    });
  }
  return out;
}

/** Liczba z „1 299,00 zł" / "1,299.00" / 1299 → 1299 (najlepszy wysiłek). */
export function toNumber(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  let s = v.replace(/[^\d.,]/g, "");
  if (!s) return 0;
  // „1 299,00" → kropka dziesiętna; usuń separatory tysięcy.
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "link"; }
}

/** Mediana cen (do oceny okazji i wykrywania podejrzanie tanich). */
export function median(nums: number[]): number {
  const a = nums.filter((n) => n > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * Oceń ofertę względem mediany:
 *  - "scam"  — podejrzanie tania (< 45% mediany) → ryzyko oszustwa,
 *  - "deal"  — realna okazja (≤ 80% mediany),
 *  - "high"  — drogo (≥ 130% mediany),
 *  - "fair"  — w normie.
 */
export function dealFlag(price: number, med: number): DealFlag {
  if (!(med > 0) || !(price > 0)) return "fair";
  if (price < med * 0.45) return "scam";
  if (price <= med * 0.8) return "deal";
  if (price >= med * 1.3) return "high";
  return "fair";
}

/** Posortuj oferty rosnąco i wskaż najtańszą nową i najtańszą używaną. */
export function rankOffers(offers: Offer[]): Ranked {
  const sorted = [...offers].filter((o) => o.price > 0).sort((a, b) => a.price - b.price);
  const cheapestNew = sorted.find((o) => o.condition === "new") || null;
  const cheapestUsed = sorted.find((o) => o.condition === "used") || null;
  return { sorted, cheapestNew, cheapestUsed, median: median(sorted.map((o) => o.price)) };
}

/**
 * Znajdź najtańsze oferty dla zapytania. Zawsze zwraca deep-linki; gdy jest klucz
 * AI z wyszukiwaniem w sieci, dokłada zagregowaną, posortowaną listę ofert.
 */
export async function findBargains(query: string, region = "Polska"): Promise<BargainResult> {
  const clean = query.trim();
  const links = marketLinks(clean);
  if (!clean) return { query: "", currency: "PLN", offers: [], links, tips: [] };

  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) {
    return { query: clean, currency: "PLN", offers: [], links, tips: [], note: "no-ai" };
  }

  resetCitations();
  try {
    const text = await askModel({ system: buildBargainPrompt(region), history: [{ role: "user", content: `Znajdź najtaniej: ${clean}` }], webSearch: true });
    const parsed = parseBargain(text);
    return {
      query: clean,
      normalized: parsed?.normalized,
      currency: parsed?.currency || "PLN",
      offers: parsed?.offers ?? [],
      links,
      tips: parsed?.tips ?? [],
      citations: getCitations(),
    };
  } catch (e) {
    return { query: clean, currency: "PLN", offers: [], links, tips: [], error: e instanceof Error ? e.message : String(e) };
  }
}
