// Lista zakupów — wpisujesz kilka rzeczy naraz, a JARVIS znajduje KAŻDĄ najtaniej
// i sumuje koszyk. Buduje na Łowcy Okazji (findBargains): dla każdej pozycji bierze
// najtańszą znalezioną ofertę. Czyste funkcje (parseItems, basketSummary) — testowalne.

import { findBargains, rankOffers, type Offer } from "./bargain";

export interface BasketLine {
  query: string;
  best: Offer | null;
  offers: number;
  error?: boolean;
}

export interface BasketSummary {
  total: number;
  currency: string;
  found: number;
  missing: number;
}

/** Rozbij wpisany tekst na pozycje (nowe linie, przecinki, średniki). Maks. 15. */
export function parseItems(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text || "").split(/[\n,;]+/)) {
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 15) break;
  }
  return out;
}

/** Podsumuj koszyk: suma najtańszych, ile znaleziono, ile bez ceny. */
export function basketSummary(lines: BasketLine[]): BasketSummary {
  let total = 0;
  let found = 0;
  let missing = 0;
  let currency = "PLN";
  for (const l of lines) {
    if (l.best && l.best.price > 0) {
      total += l.best.price;
      found++;
      currency = l.best.currency || currency;
    } else {
      missing++;
    }
  }
  return { total, currency, found, missing };
}

/** Znajdź najtańszą ofertę dla każdej pozycji listy (po kolei, z raportem postępu). */
export async function findBasket(
  queries: string[],
  onProgress?: (done: number, total: number, line: BasketLine) => void,
): Promise<BasketLine[]> {
  const lines: BasketLine[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    let line: BasketLine;
    try {
      const r = await findBargains(q);
      line = { query: q, best: rankOffers(r.offers).sorted[0] || null, offers: r.offers.length };
    } catch {
      line = { query: q, best: null, offers: 0, error: true };
    }
    lines.push(line);
    onProgress?.(i + 1, queries.length, line);
  }
  return lines;
}
