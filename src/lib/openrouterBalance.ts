// Faza 6 (część bezpieczna) — odczyt salda OpenRouter + alert przy niskim stanie.
// WYŁĄCZNIE read-only: pobieramy stan środków (GET /credits). Żadnych metod płatności,
// żadnego doładowywania, nic nie obciąża karty.

import { fetchTimeout } from "./http";
import { dedupe } from "./resilience";

export interface Credits {
  total: number; // przyznane środki (USD)
  usage: number; // zużyte (USD)
  remaining: number; // pozostało (USD)
}

/** Sparsuj odpowiedź GET /api/v1/credits → saldo. Czysta funkcja. */
export function parseCredits(json: unknown): Credits | null {
  const d = (json as { data?: { total_credits?: unknown; total_usage?: unknown } })?.data;
  if (!d) return null;
  const total = typeof d.total_credits === "number" ? d.total_credits : NaN;
  const usage = typeof d.total_usage === "number" ? d.total_usage : NaN;
  if (!Number.isFinite(total) || !Number.isFinite(usage)) return null;
  return { total, usage, remaining: total - usage };
}

/** Czy saldo jest niskie (≤ próg). Próg ≤ 0 = alert wyłączony. */
export function isLowBalance(remaining: number, thresholdUsd: number): boolean {
  return thresholdUsd > 0 && remaining <= thresholdUsd;
}

/** Pobierz saldo OpenRouter (read-only). Zwraca null przy braku klucza/sieci/błędzie. */
export async function fetchOpenRouterCredits(apiKey: string): Promise<Credits | null> {
  const key = (apiKey || "").trim();
  if (!key) return null;
  // Deduplikacja: równoległe otwarcia panelu kosztów współdzielą jedno zapytanie.
  return dedupe("orcredits:" + key, () => fetchCreditsRaw(key));
}

async function fetchCreditsRaw(key: string): Promise<Credits | null> {
  try {
    const res = await fetchTimeout(
      "https://openrouter.ai/api/v1/credits",
      { headers: { authorization: `Bearer ${key}` } },
      12000,
    );
    if (!res.ok) return null;
    return parseCredits(await res.json().catch(() => null));
  } catch {
    return null;
  }
}
