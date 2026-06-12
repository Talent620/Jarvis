import { PROVIDERS } from "./providers/registry";
import { testProvider } from "./brain";
import { keyList } from "./keys";
import { fetchTimeout } from "./http";
import type { ProviderId } from "./providers/types";

// === Status i zużycie API ===
// Dla każdego dostawcy z kluczem: 🟢 działa / 🟡 limit się kończy / 🔴 nie działa
// + procent zużycia tam, gdzie dostawca go UDOSTĘPNIA (uczciwie):
//  - OpenRouter: realne saldo kredytów (endpoint /key) — wszędzie.
//  - Anthropic/Groq: nagłówki limitów (okno czasowe) — gdy środowisko je odsłania.
//  - Gemini/Mistral/Cerebras/NVIDIA/GitHub: brak licznika w API → sam status.

export interface ApiStatus {
  provider: ProviderId;
  state: "ok" | "warn" | "err";
  /** Zużycie limitu w % (0–100), jeśli dostawca je udostępnia. */
  usedPct?: number;
  detail: string;
}

/** Klasyfikacja wyniku testu (czysta, testowalna): 429/limit → żółty, inny błąd → czerwony. */
export function classifyTestResult(msg: string): "ok" | "warn" | "err" {
  if (/^✅/.test(msg)) return "ok";
  if (/429|rate.?limit|limit|quota|exceed|wyczerp|przekroczon/i.test(msg)) return "warn";
  return "err";
}

/** % zużycia z pary (pozostało, limit) — czysta, testowalna. */
export function pctUsed(remaining: number, limit: number): number | undefined {
  if (!isFinite(remaining) || !isFinite(limit) || limit <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((1 - remaining / limit) * 100)));
}

/** OpenRouter: realne zużycie kredytów konta (USD). */
async function openrouterUsage(key: string): Promise<{ usedPct?: number; extra: string }> {
  try {
    const res = await fetchTimeout("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` } }, 8000);
    const d = (await res.json().catch(() => null))?.data;
    if (!d) return { extra: "" };
    if (typeof d.limit === "number" && d.limit > 0) {
      const pct = Math.max(0, Math.min(100, Math.round(((d.usage || 0) / d.limit) * 100)));
      return { usedPct: pct, extra: ` Zużyto $${(d.usage || 0).toFixed(2)} z $${d.limit} (${pct}%).` };
    }
    return { extra: ` Zużyto $${(d.usage || 0).toFixed(2)} (konto bez twardego limitu).` };
  } catch {
    return { extra: "" };
  }
}

/** Anthropic/Groq: spróbuj odczytać nagłówki limitów (okno czasowe) — best effort. */
async function headerUsage(provider: ProviderId, key: string): Promise<{ usedPct?: number; extra: string }> {
  try {
    const cfg =
      provider === "anthropic"
        ? { url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, rem: "anthropic-ratelimit-requests-remaining", lim: "anthropic-ratelimit-requests-limit", win: "minutowe" }
        : { url: "https://api.groq.com/openai/v1/models", headers: { authorization: `Bearer ${key}` }, rem: "x-ratelimit-remaining-requests", lim: "x-ratelimit-limit-requests", win: "dzienne" };
    const res = await fetchTimeout(cfg.url, { headers: cfg.headers as any }, 8000);
    const rem = Number(res.headers.get(cfg.rem));
    const lim = Number(res.headers.get(cfg.lim));
    const pct = pctUsed(rem, lim);
    if (pct === undefined) return { extra: "" };
    return { usedPct: pct, extra: ` Okno ${cfg.win}: zużyte ${pct}% (zostało ${rem}/${lim} zapytań).` };
  } catch {
    return { extra: "" };
  }
}

/** Sprawdź jednego dostawcę: status + (gdzie się da) zużycie. */
export async function checkApiStatus(provider: ProviderId): Promise<ApiStatus | null> {
  const key = keyList(provider)[0];
  if (provider === "ollama" || !key) return null;
  const test = await testProvider(provider, key);
  const state = classifyTestResult(test);
  let usedPct: number | undefined;
  let extra = "";

  if (state !== "err") {
    if (provider === "openrouter") ({ usedPct, extra } = await openrouterUsage(key));
    else if (provider === "anthropic" || provider === "groq") ({ usedPct, extra } = await headerUsage(provider, key));
    else extra = " Dostawca nie udostępnia licznika zużycia — status na podstawie żywego testu.";
  }

  const base = state === "ok" ? "Działa." : state === "warn" ? "Klucz OK, ale limit wyczerpany/blisko — odnowi się automatycznie." : test.replace(/^❌\s*/, "");
  // Wysokie zużycie → ostrzeż kolorem, nawet jeśli test przeszedł.
  const finalState = state === "ok" && usedPct !== undefined && usedPct >= 85 ? "warn" : state;
  return { provider, state: finalState, usedPct, detail: `${base}${extra}` };
}

/** Sprawdź wszystkich dostawców z kluczami (sekwencyjnie, z aktualizacjami na żywo). */
export async function checkAllApis(onUpdate?: (map: Partial<Record<ProviderId, ApiStatus>>) => void): Promise<Partial<Record<ProviderId, ApiStatus>>> {
  const out: Partial<Record<ProviderId, ApiStatus>> = {};
  for (const p of Object.values(PROVIDERS)) {
    const st = await checkApiStatus(p.id);
    if (st) {
      out[p.id] = st;
      onUpdate?.({ ...out });
    }
  }
  return out;
}

export const stateDot = (s: ApiStatus["state"]) => (s === "ok" ? "🟢" : s === "warn" ? "🟡" : "🔴");
