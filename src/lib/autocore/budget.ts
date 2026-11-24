// === AUTOCORE · Globalny kontroler budżetu (jeden limit, twarda blokada płatnych operacji) ===
// Jedno źródło limitu miesięcznego = istniejące ustawienie `aiMonthlyBudgetUsd` (bez nowego,
// równoległego pola). Limit dzienny: własne pole AutoCore (domyślnie 1/10 miesięcznego).
// Dziennik wydatków = istniejący `usageTelemetry` (ten sam, który czyta panel kosztów i rezerwa mózgu).
// Zasady:
//  • local/free (zweryfikowane) → zawsze dozwolone (offline/lokalny tryb nie może paść przez budżet),
//  • NOWO podłączona usługa, która może być płatna (freemium/credit/paid/unknown) → „oczekuje"
//    do jawnego zatwierdzenia z ustawionym limitem (nie zakładamy darmowości z powodu free tieru),
//  • klucze istniejące przed AutoCore NIE są blokowane (brak regresji) — blokada dotyczy tylko „oczekujących",
//  • osiągnięty limit dzienny lub miesięczny → twarda blokada wszystkiego poza local/free.
import { loadJson, saveJson } from "../lsJson";
import { store } from "../store";
import { loadUsage, within, totals, forecastMonthlyUsd, recordUsage, parsePricingOverrides } from "../usageTelemetry";
import type { ProviderId, TokenUsage } from "../providers/types";
import { PROFILES, budgetPriceFor, costClassOf, type CostClass } from "./catalog";

const STORE_KEY = "jarvis.autocore.budget.v1";

interface BudgetStore {
  /** 0 = automatycznie 1/10 limitu miesięcznego. */
  dailyUsd: number;
  /** Nowo podłączeni dostawcy czekający na zatwierdzenie limitu. */
  pending: ProviderId[];
  /** Modele potwierdzone jako darmowe przez discovery (cena 0 w oficjalnym /models): "provider|model". */
  verifiedFree: string[];
}

let cache: BudgetStore | null = null;
const B = (): BudgetStore => (cache ??= { dailyUsd: 0, pending: [], verifiedFree: [], ...loadJson<Partial<BudgetStore>>(STORE_KEY, {}) });
const persist = () => saveJson(STORE_KEY, B());

export const isVerifiedFree = (p: ProviderId, m: string): boolean => B().verifiedFree.includes(`${p}|${m}`);

export function markVerifiedFree(p: ProviderId, models: string[]): void {
  const s = new Set(B().verifiedFree.filter((k) => !k.startsWith(p + "|")));
  for (const m of models) s.add(`${p}|${m}`);
  B().verifiedFree = Array.from(s).slice(-2000);
  persist();
}

export function costClass(p: ProviderId, model: string): CostClass {
  return costClassOf(p, model, isVerifiedFree);
}

const startOfDay = (now: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };
const startOfMonth = (now: number) => { const d = new Date(now); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); };

export interface BudgetState {
  monthlyLimitUsd: number;
  dailyLimitUsd: number;
  spentMonthUsd: number;
  spentTodayUsd: number;
  forecastMonthUsd: number;
  level: "none" | "ok" | "warn" | "stop";
  message: string;
  pending: ProviderId[];
}

/** Pure: poziom budżetu z liczb (testowalne bez stanu). */
export function evaluateBudget(spentMonth: number, spentToday: number, forecast: number, monthly: number, daily: number): Pick<BudgetState, "level" | "message"> {
  if (monthly <= 0 && daily <= 0) return { level: "none", message: "Brak limitu — płatne usługi działają tylko te już skonfigurowane; nowe czekają na limit." };
  if (monthly > 0 && spentMonth >= monthly) return { level: "stop", message: `Limit miesięczny ${monthly.toFixed(2)} USD osiągnięty — płatne operacje zatrzymane (działa lokalny/darmowy mózg).` };
  if (daily > 0 && spentToday >= daily) return { level: "stop", message: `Limit dzienny ${daily.toFixed(2)} USD osiągnięty — płatne operacje wstrzymane do jutra.` };
  if ((monthly > 0 && (spentMonth >= monthly * 0.8 || forecast > monthly)) || (daily > 0 && spentToday >= daily * 0.8))
    return { level: "warn", message: `Uwaga: ${spentMonth.toFixed(2)} z ${monthly > 0 ? monthly.toFixed(2) : "∞"} USD w tym miesiącu (prognoza ${forecast.toFixed(2)} USD).` };
  return { level: "ok", message: `Budżet OK: ${spentMonth.toFixed(2)} / ${monthly > 0 ? monthly.toFixed(2) : "∞"} USD.` };
}

export function budgetState(now = Date.now()): BudgetState {
  const monthly = Math.max(0, store.settings.aiMonthlyBudgetUsd || 0);
  const daily = B().dailyUsd > 0 ? B().dailyUsd : monthly > 0 ? monthly / 10 : 0;
  const all = loadUsage();
  const spentMonth = totals(within(all, startOfMonth(now))).costUsd;
  const spentToday = totals(within(all, startOfDay(now))).costUsd;
  const forecast = forecastMonthlyUsd(all, now);
  return { monthlyLimitUsd: monthly, dailyLimitUsd: daily, spentMonthUsd: spentMonth, spentTodayUsd: spentToday, forecastMonthUsd: forecast, pending: [...B().pending], ...evaluateBudget(spentMonth, spentToday, forecast, monthly, daily) };
}

export interface GateResult { allowed: boolean; costClass: CostClass; reason?: string }

/** Czy wolno wykonać wywołanie (provider, model) teraz. */
export function budgetGate(p: ProviderId, model: string, now = Date.now()): GateResult {
  const cls = costClass(p, model);
  if (cls === "local" || cls === "free") return { allowed: true, costClass: cls };
  if (B().pending.includes(p)) return { allowed: false, costClass: cls, reason: "nowa usługa może być płatna — zatwierdź limit w AUTOCORE" };
  const st = budgetState(now);
  if (st.level === "stop") return { allowed: false, costClass: cls, reason: st.message };
  return { allowed: true, costClass: cls };
}

/** Odfiltruj łańcuch prób przez bramkę budżetu. Może zwrócić pusty (twarda blokada) — caller pokazuje powód. */
export function budgetFilter<T extends { provider: ProviderId; model: string }>(order: T[], now = Date.now()): { kept: T[]; blocked: { provider: ProviderId; reason: string }[] } {
  const kept: T[] = [];
  const blocked: { provider: ProviderId; reason: string }[] = [];
  for (const o of order) {
    const g = budgetGate(o.provider, o.model, now);
    if (g.allowed) kept.push(o); else blocked.push({ provider: o.provider, reason: g.reason || "zablokowane budżetem" });
  }
  return { kept, blocked };
}

/** Nowo podłączona usługa: jeśli może być płatna — oznacz jako oczekującą (zwraca true, gdy oczekuje). */
export function registerNewService(p: ProviderId, sampleModel: string): boolean {
  const cls = costClass(p, sampleModel);
  if (cls === "local" || cls === "free") return false;
  if (!B().pending.includes(p)) { B().pending.push(p); persist(); }
  return true;
}

/**
 * Zatwierdź oczekującą usługę. Wymaga dodatniego limitu miesięcznego (istniejącego albo podanego) —
 * bez limitu nie uruchamiamy nowych płatnych usług.
 */
export function authorizeService(p: ProviderId, monthlyLimitUsd?: number): { ok: boolean; message: string } {
  const limit = monthlyLimitUsd ?? store.settings.aiMonthlyBudgetUsd ?? 0;
  if (!(limit > 0)) return { ok: false, message: "Ustaw miesięczny limit (USD), zanim zatwierdzisz usługę, która może być płatna." };
  if (monthlyLimitUsd && monthlyLimitUsd !== store.settings.aiMonthlyBudgetUsd) store.setSettings({ aiMonthlyBudgetUsd: monthlyLimitUsd });
  B().pending = B().pending.filter((x) => x !== p);
  persist();
  return { ok: true, message: `Zatwierdzono ${p} z limitem ${limit.toFixed(2)} USD/mies.` };
}

export function setDailyLimit(usd: number): void { B().dailyUsd = Math.max(0, usd || 0); persist(); }

/** Bramka budżetu dla płatnych usług spoza ProviderId (ElevenLabs, OpenAI TTS, Fish, Fal.ai, Tavily). */
export function budgetGateExternal(service: string, now = Date.now()): GateResult {
  const s = String(service || "").toLowerCase();
  if (s === "native" || s === "local" || s === "system" || s === "pollinations" || s === "local-sd") {
    return { allowed: true, costClass: "local" };
  }
  const st = budgetState(now);
  if (st.level === "stop") return { allowed: false, costClass: "paid", reason: st.message };
  return { allowed: true, costClass: "paid" };
}

/**
 * Realistyczna wycena jednostkowa (USD) dla usług pobocznych bez licznika tokenów
 * (koniec raportowania 0 USD dla płatnych wywołań TTS / STT / obrazów / search / embeddingów).
 */
export function estimateSideServiceCost(provider: string, model: string, units = 1): number {
  const p = String(provider || "").toLowerCase();
  const m = String(model || "").toLowerCase();
  const u = Math.max(1, Number(units) || 1);
  if (p === "elevenlabs") return Math.max(0.001, (u / 1000) * 0.18); // ~$0.18 / 1k znaków
  if (p === "openai-tts") return Math.max(0.0005, (u / 1000) * (m.includes("hd") ? 0.03 : 0.015));
  if (p === "fish") return Math.max(0.0005, (u / 1000) * 0.015);
  if (p === "fal") return (m.includes("nano-banana") ? 0.08 : 0.04) * u;
  if (p === "tavily") return (m.includes("basic") ? 0.008 : 0.016) * u;
  if (p === "gemini") {
    if (m.includes("tts")) return Math.max(0.0002, (u / 1000) * 0.01);
    if (m.includes("image") || m.includes("imagen")) return 0.039 * u;
    if (m.includes("embedding")) return Math.max(0.0001, (u / 1000) * 0.000025);
    if (m.includes("live")) return Math.max(0.0005, (u / 60) * 0.002);
  }
  if (p === "groq" && m.includes("whisper")) return Math.max(0.0002, (u / 60) * 0.00067);
  return 0;
}

/** Zapisz koszt płatnej usługi spoza ProviderId w jednym dzienniku zużycia (usageTelemetry). */
export function recordExternalCall(service: string, model: string, costUsd: number, now = Date.now()): number {
  const usd = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
  if (usd <= 0) return 0;
  recordUsage({
    at: now,
    provider: service as ProviderId,
    model: model || service,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: usd,
  });
  return usd;
}

/** Szacunkowy koszt wywołania (USD) — tokeny wg cennika + czas GPU dla dostawców rozliczanych czasem. */
export function estimateCallCost(p: ProviderId, model: string, usage?: TokenUsage, latencyMs?: number): { usd: number; estimated: boolean } {
  const { price, estimated } = budgetPriceFor(p, model, parsePricingOverrides(store.settings.aiPricingOverrides || ""), isVerifiedFree);
  let usd = usage ? (usage.inputTokens / 1e6) * price.in + (usage.outputTokens / 1e6) * price.out : 0;
  const perS = PROFILES[p]?.usdPerSecond;
  if (perS && latencyMs && latencyMs > 0) usd += (latencyMs / 1000) * perS;
  return { usd, estimated: estimated || !!perS };
}

/** Zapisz wywołanie w JEDNYM dzienniku zużycia (usageTelemetry). Wspiera fallbackUsd dla usług nietokenowych (TTS/STT/image/embed). */
export function recordCall(
  p: ProviderId,
  model: string,
  usage: TokenUsage | undefined,
  latencyMs?: number,
  now = Date.now(),
  opts?: { fallbackUsd?: number },
): number {
  const hasTokens = !!usage && (usage.inputTokens > 0 || usage.outputTokens > 0);
  const { usd: baseUsd } = estimateCallCost(p, model, hasTokens ? usage : undefined, latencyMs);
  const usd = baseUsd > 0 ? baseUsd : Math.max(0, Number(opts?.fallbackUsd) || 0);
  if (!hasTokens && usd <= 0) return 0;
  recordUsage({ at: now, provider: p, model, inputTokens: usage?.inputTokens || 0, outputTokens: usage?.outputTokens || 0, costUsd: usd });
  return usd;
}

/** Tylko testy. */
export function resetBudget(): void { cache = { dailyUsd: 0, pending: [], verifiedFree: [] }; persist(); }
