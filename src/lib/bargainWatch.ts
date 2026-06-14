// Obserwowane okazje — uczciwy „tracker" cen dla Łowcy Okazji. Zapamiętuje
// najniższą widzianą cenę przedmiotu i przy ponownym sprawdzeniu mówi, czy
// staniało, podrożało, czy to nowy rekord — oraz czy osiągnięto próg (cel).
// Bez scrapowania w tle: sprawdzasz, gdy chcesz, a JARVIS porównuje z pamięcią.
// Czyste funkcje (priceChange, applyObservation) — w pełni testowalne.

import type { WatchedItem } from "../types";
import { store, uid } from "./store";

export interface PriceChange {
  dir: "new" | "down" | "up" | "same";
  delta: number; // różnica względem poprzedniej ceny (ujemna = taniej)
  pct: number; // procentowa zmiana (zaokrąglona)
}

/** Porównaj nową cenę z poprzednio widzianą. */
export function priceChange(prev: number | undefined, next: number): PriceChange {
  if (!(next > 0)) return { dir: "same", delta: 0, pct: 0 };
  if (!(prev && prev > 0)) return { dir: "new", delta: 0, pct: 0 };
  const delta = next - prev;
  if (delta === 0) return { dir: "same", delta: 0, pct: 0 };
  return { dir: delta < 0 ? "down" : "up", delta, pct: Math.round((delta / prev) * 100) };
}

export interface Observation {
  item: WatchedItem;
  change: PriceChange;
  hitTarget: boolean;
}

/** Nanieś nową obserwację ceny: aktualizuj rekord najniższej ceny i ostatnią cenę. */
export function applyObservation(item: WatchedItem, next: number, currency: string | undefined, now = Date.now()): Observation {
  const change = priceChange(item.lastPrice, next);
  const best = item.bestPrice && item.bestPrice > 0 ? Math.min(item.bestPrice, next) : next;
  const updated: WatchedItem = {
    ...item,
    lastPrice: next,
    bestPrice: best,
    bestCurrency: currency || item.bestCurrency || "PLN",
    lastCheckedAt: now,
  };
  return { item: updated, change, hitTarget: !!(item.targetPrice && item.targetPrice > 0 && next <= item.targetPrice) };
}

const norm = (q: string) => q.trim().toLowerCase();

export function loadWatches(): WatchedItem[] {
  return store.data.bargainWatch || [];
}

export function findWatch(query: string): WatchedItem | null {
  const n = norm(query);
  return loadWatches().find((w) => norm(w.query) === n) || null;
}

/** Dodaj przedmiot do obserwowanych (lub zaktualizuj próg, jeśli już jest). */
export function addWatch(query: string, price?: number, currency?: string, target?: number): WatchedItem {
  const q = query.trim();
  const existing = findWatch(q);
  if (existing) {
    if (target != null) setTarget(existing.id, target);
    return existing;
  }
  const has = !!(price && price > 0);
  const item: WatchedItem = {
    id: uid(),
    query: q,
    createdAt: Date.now(),
    bestPrice: has ? price : undefined,
    lastPrice: has ? price : undefined,
    bestCurrency: currency || "PLN",
    targetPrice: target && target > 0 ? target : undefined,
    lastCheckedAt: has ? Date.now() : undefined,
  };
  store.setData((d) => {
    if (!d.bargainWatch) d.bargainWatch = [];
    d.bargainWatch.unshift(item);
  });
  return item;
}

export function removeWatch(id: string): void {
  store.setData((d) => {
    d.bargainWatch = (d.bargainWatch || []).filter((w) => w.id !== id);
  });
}

export function setTarget(id: string, target: number): void {
  store.setData((d) => {
    const w = (d.bargainWatch || []).find((x) => x.id === id);
    if (w) w.targetPrice = target > 0 ? target : undefined;
  });
}

/** Zapisz świeżą cenę dla obserwowanego przedmiotu; zwróć zmianę albo null. */
export function recordObservation(query: string, price: number, currency?: string): Observation | null {
  const w = findWatch(query);
  if (!w || !(price > 0)) return null;
  const obs = applyObservation(w, price, currency);
  store.setData((d) => {
    const list = d.bargainWatch || [];
    const i = list.findIndex((x) => x.id === w.id);
    if (i >= 0) list[i] = obs.item;
  });
  return obs;
}
