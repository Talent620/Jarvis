// Faza 5 — telemetria kosztów/zużycia.
// Zapisuje zużycie tokenów per wywołanie (z API, gdy dostępne), wycenia wg cennika
// (z możliwością nadpisania w configu), agreguje (dziś/7 dni/30 dni, per dostawca/model),
// prognozuje miesięczny koszt (run-rate) i sprawdza budżet. Czyste funkcje + cienka
// warstwa trwałości w localStorage (przeżywa odświeżenie PWA).

import type { ProviderId, TokenUsage } from "./providers/types";

export interface UsageEntry {
  at: number;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Cena modelu w USD za 1 mln tokenów (wejście/wyjście). */
export interface ModelPrice {
  in: number;
  out: number;
}

// Domyślny cennik (USD / 1M tokenów). Modele z darmowym tierem ≈ 0. Nadpisywalny w configu.
export const DEFAULT_PRICING: Record<string, ModelPrice> = {
  // Anthropic
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  // Gemini
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
  // Groq (Faza 4)
  "meta-llama/llama-4-scout-17b-16e-instruct": { in: 0.11, out: 0.34 },
  "moonshotai/kimi-k2-instruct": { in: 1, out: 3 },
  "llama-3.3-70b-versatile": { in: 0.59, out: 0.79 },
  "llama-3.1-8b-instant": { in: 0.05, out: 0.08 },
};

/** Cennik dla modelu: najpierw nadpisania z configu, potem domyślny, w ostateczności 0 (np. darmowe/lokalne). */
export function priceFor(model: string, overrides?: Record<string, ModelPrice>): ModelPrice {
  return overrides?.[model] || DEFAULT_PRICING[model] || { in: 0, out: 0 };
}

/** Koszt pojedynczego wywołania w USD. */
export function costOf(usage: TokenUsage, price: ModelPrice): number {
  return (usage.inputTokens / 1e6) * price.in + (usage.outputTokens / 1e6) * price.out;
}

/** Parsuj nadpisania cennika z JSON-a (z configu). Błędny JSON → undefined (użyj domyślnych). */
export function parsePricingOverrides(json: string): Record<string, ModelPrice> | undefined {
  const s = (json || "").trim();
  if (!s) return undefined;
  try {
    const obj = JSON.parse(s);
    if (!obj || typeof obj !== "object") return undefined;
    const out: Record<string, ModelPrice> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = v as { in?: unknown; out?: unknown };
      if (typeof p?.in === "number" && typeof p?.out === "number") out[k] = { in: p.in, out: p.out };
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

// --- Agregacje (czyste) ---

export interface Totals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function within(entries: UsageEntry[], sinceMs: number): UsageEntry[] {
  return entries.filter((e) => e.at >= sinceMs);
}

export function totals(entries: UsageEntry[]): Totals {
  return entries.reduce<Totals>(
    (acc, e) => {
      acc.calls += 1;
      acc.inputTokens += e.inputTokens;
      acc.outputTokens += e.outputTokens;
      acc.costUsd += e.costUsd;
      return acc;
    },
    { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );
}

/** Rozbicie sum wg klucza (dostawca lub model). */
export function breakdown(entries: UsageEntry[], key: "provider" | "model"): Record<string, Totals> {
  const out: Record<string, Totals> = {};
  for (const e of entries) {
    const k = e[key];
    (out[k] ||= { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    out[k].calls += 1;
    out[k].inputTokens += e.inputTokens;
    out[k].outputTokens += e.outputTokens;
    out[k].costUsd += e.costUsd;
  }
  return out;
}

const DAY = 86_400_000;

/** Prognoza kosztu miesięcznego (USD) z run-rate ostatnich 7 dni. */
export function forecastMonthlyUsd(entries: UsageEntry[], now: number = Date.now()): number {
  const weekCost = totals(within(entries, now - 7 * DAY)).costUsd;
  return (weekCost / 7) * 30;
}

export interface BudgetStatus {
  budgetUsd: number;
  spentUsd: number;
  pct: number; // 0..(>1)
  over: boolean;
  warn: boolean; // ≥ 80%
}

/** Status budżetu miesięcznego. budget ≤ 0 = brak limitu (nigdy over/warn). */
export function budgetStatus(spentUsd: number, budgetUsd: number): BudgetStatus {
  if (budgetUsd <= 0) return { budgetUsd, spentUsd, pct: 0, over: false, warn: false };
  const pct = spentUsd / budgetUsd;
  return { budgetUsd, spentUsd, pct, over: pct >= 1, warn: pct >= 0.8 };
}

// --- Trwałość (localStorage) ---

const KEY = "jarvis.usage.v1";
const MAX = 2000;

export function loadUsage(): UsageEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(entries: UsageEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch {
    /* brak miejsca — telemetria nie może wywrócić aplikacji */
  }
}

/** Dopisz wpis zużycia (najnowsze pierwsze, z capem). Pomija puste (0/0) wywołania. */
export function recordUsage(entry: UsageEntry): void {
  // Zapisuj też wpisy bez tokenów, ale z KOSZTEM (np. generacja obrazu fal.ai liczona za sztukę).
  if (!entry.inputTokens && !entry.outputTokens && !entry.costUsd) return;
  const all = loadUsage();
  all.unshift(entry);
  save(all);
}

export function clearUsage(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
