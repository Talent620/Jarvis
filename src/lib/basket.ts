// Lista zakupów — wpisujesz kilka rzeczy naraz, a JARVIS znajduje KAŻDĄ najtaniej
// i sumuje koszyk. Buduje na Łowcy Okazji (findBargains): dla każdej pozycji bierze
// najtańszą znalezioną ofertę. Czyste funkcje (parseItems, basketSummary) — testowalne.

import { findBargains, rankOffers, type Offer } from "./bargain";
import type { ShoppingItem } from "../types";

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

/** Zamień zapisaną listę zakupów na tekst do edytora (każda pozycja w nowej linii). */
export function shoppingToText(items: ShoppingItem[] | undefined): string {
  return (items || []).map((i) => (i.qty ? `${i.qty} ${i.name}` : i.name)).join("\n");
}

/**
 * Czyste: zsynchronizuj kolekcję store.data.shopping z aktualnie wpisanymi nazwami.
 * Zachowuje id / done / createdAt dla pozycji, które już istniały (dopasowanie po
 * nazwie, bez wielkości liter), tworzy nowe dla nowych nazw, usuwa skreślone z tekstu.
 * Kolejność = kolejność z tekstu. uid + now wstrzykiwane (testowalność, brak Date.now w środku).
 */
export function syncShoppingItems(
  prev: ShoppingItem[] | undefined,
  names: string[],
  uid: () => string,
  now: number,
): ShoppingItem[] {
  const byName = new Map<string, ShoppingItem>();
  for (const it of prev || []) byName.set(it.name.trim().toLowerCase(), it);
  const out: ShoppingItem[] = [];
  const used = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    const existing = byName.get(key);
    if (existing) out.push({ ...existing, name });
    else out.push({ id: uid(), name, done: false, createdAt: now });
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
