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

/** Maks. liczba punktów historii trzymanych per przedmiot. */
const HISTORY_CAP = 30;

/** Nanieś nową obserwację ceny: aktualizuj rekord, ostatnią cenę i historię. */
export function applyObservation(item: WatchedItem, next: number, currency: string | undefined, now = Date.now()): Observation {
  const change = priceChange(item.lastPrice, next);
  const best = item.bestPrice && item.bestPrice > 0 ? Math.min(item.bestPrice, next) : next;
  const history = [...(item.history || []), { at: now, price: next }].slice(-HISTORY_CAP);
  const updated: WatchedItem = {
    ...item,
    lastPrice: next,
    bestPrice: best,
    bestCurrency: currency || item.bestCurrency || "PLN",
    lastCheckedAt: now,
    history,
  };
  return { item: updated, change, hitTarget: !!(item.targetPrice && item.targetPrice > 0 && next <= item.targetPrice) };
}

export interface PriceTrend {
  first: number;
  last: number;
  min: number;
  max: number;
  changePct: number;
  points: number;
  dir: "down" | "up" | "same";
}

/** Policz trend cen z historii (kierunek, % zmiany od pierwszego pomiaru, min/max). */
export function priceTrend(history: { at: number; price: number }[] | undefined): PriceTrend | null {
  const h = (history || []).filter((p) => p && p.price > 0);
  if (!h.length) return null;
  const prices = h.map((p) => p.price);
  const first = prices[0];
  const last = prices[prices.length - 1];
  const changePct = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  return {
    first,
    last,
    min: Math.min(...prices),
    max: Math.max(...prices),
    changePct,
    points: h.length,
    dir: last < first ? "down" : last > first ? "up" : "same",
  };
}

/** Zbuduj punkty mini-wykresu (polyline „x,y x,y …") z listy cen. Pusty, gdy za mało danych. */
export function sparkline(prices: number[], w = 84, h = 26): string {
  const v = prices.filter((p) => p > 0);
  if (v.length < 2) return "";
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  return v
    .map((p, i) => {
      const x = (i / (v.length - 1)) * (w - 2) + 1;
      const y = h - 1 - ((p - min) / span) * (h - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
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
    history: has ? [{ at: Date.now(), price: price! }] : [],
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
