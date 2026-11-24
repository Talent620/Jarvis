// === AUTOCORE · Router zadań (klasy A–J) + dziennik zmian routingu + automatyczny rollback ===
// Zasada zgodności: BEZ danych pomiarowych kolejność = dotychczasowa ranga z registry (żadnej
// niespodziewanej zmiany zachowania). Pomiary (niezawodność, latencja, jakość z eksperymentów)
// i presja budżetu przesuwają kolejność dopiero, gdy są realne dane.
import { loadJson, saveJson } from "../lsJson";
import type { ProviderId } from "../providers/types";
import { PROFILES } from "./catalog";
import { reliabilityOf, latencyOf, providerSampleCount } from "./health";

export type TaskClass =
  | "A_reasoning" | "B_chat" | "C_coding" | "D_repo" | "E_vision" | "F_live_vision"
  | "G_stt" | "H_tts" | "I_tools" | "J_agent";

export const TASK_CLASS_LABEL: Record<TaskClass, string> = {
  A_reasoning: "rozumowanie", B_chat: "rozmowa", C_coding: "programowanie", D_repo: "analiza repozytorium",
  E_vision: "obraz", F_live_vision: "Live Vision", G_stt: "mowa→tekst", H_tts: "tekst→mowa",
  I_tools: "narzędzia/automatyzacje", J_agent: "długie zadanie agenta",
};

/** Wymagania klasy: wizja (twardy filtr), narzędzia, wrażliwość na opóźnienie, czy „proste" (tani model). */
export const TASK_NEEDS: Record<TaskClass, { vision?: boolean; tools?: boolean; latency: number; simple: boolean }> = {
  A_reasoning: { latency: 0.2, simple: false },
  B_chat: { latency: 0.6, simple: true },
  C_coding: { latency: 0.3, simple: false },
  D_repo: { latency: 0.1, simple: false },
  E_vision: { vision: true, latency: 0.4, simple: false },
  F_live_vision: { vision: true, latency: 1, simple: false },
  G_stt: { latency: 1, simple: true },
  H_tts: { latency: 1, simple: true },
  I_tools: { tools: true, latency: 0.5, simple: false },
  J_agent: { tools: true, latency: 0.1, simple: false },
};

const CODE = /```|\bkod\b|funkcj|bug|błąd w kodzie|typescript|javascript|python|refaktor|stack ?trace|kompil|regex|sql\b/i;
const REPO = /repozytor|repo\b|pull request|\bPR\b|commit|gałęź|branch|codebase|architektur/i;
const AGENT = /zaplanuj i wykonaj|krok po kroku wykonaj|autonomicz|misj|przez godzin|długie zadanie|agent/i;
const TOOLS = /przypomn|zadani|kalendarz|wyślij|maila|otwórz|uruchom|zapisz|wyszukaj w sieci|pogod|zrób|ustaw/i;
const REASON = /dlaczego|udowodnij|policz|oblicz|przeanalizuj|porównaj|strategi|zaplanuj|rozważ|wnioskuj|matematy/i;

/** Pure: klasyfikacja do klas A–J (lokalnie, bez wywołań modeli). */
export function classifyTaskClass(text: string, opts: { hasImage?: boolean; live?: boolean } = {}): TaskClass {
  if (opts.live) return "F_live_vision";
  if (opts.hasImage) return "E_vision";
  const t = text || "";
  if (REPO.test(t)) return "D_repo";
  if (CODE.test(t)) return "C_coding";
  if (AGENT.test(t)) return "J_agent";
  if (REASON.test(t) || t.length > 600) return "A_reasoning";
  if (TOOLS.test(t)) return "I_tools";
  return "B_chat";
}

export interface RankCtx {
  /** Presja kosztów: ustawiony limit lub ostrzeżenie budżetu → płatne spadają przy prostych zadaniach. */
  costPressure?: boolean;
  /** Jakość z eksperymentów (0..1) dla (provider, model, klasa) — undefined, gdy brak pomiarów. */
  quality?: (p: ProviderId, model: string, task: TaskClass) => number | undefined;
}

export interface Ranked<T> { item: T; score: number; why: string[] }

const MIN_SAMPLES = 5;

/** Pure-ish: wynik kandydata. Baseline = ranga; dodatki tylko z realnych danych. */
export function scoreCandidate(p: ProviderId, model: string, rank: number, task: TaskClass, ctx: RankCtx = {}): { score: number; why: string[] } {
  const needs = TASK_NEEDS[task];
  const why: string[] = [`ranga ${rank}`];
  let score = rank;
  if (providerSampleCount(p) >= MIN_SAMPLES) {
    const rel = reliabilityOf(p);
    const adj = Math.round((rel - 0.5) * 40); // -20..+20
    if (adj) { score += adj; why.push(`niezawodność ${(rel * 100).toFixed(0)}% (${adj > 0 ? "+" : ""}${adj})`); }
    const lat = latencyOf(p);
    if (lat !== undefined && needs.latency > 0) {
      const pen = Math.round(Math.min(20, (lat / 1000) * 2) * needs.latency); // do -20 za wolność
      if (pen) { score -= pen; why.push(`latencja ${(lat / 1000).toFixed(1)} s (-${pen})`); }
    }
  }
  const q = ctx.quality?.(p, model, task);
  if (q !== undefined) { const adj = Math.round((q - 0.5) * 40); score += adj; why.push(`jakość z testów ${(q * 100).toFixed(0)}% (${adj >= 0 ? "+" : ""}${adj})`); }
  const cls = PROFILES[p]?.costClass;
  if (ctx.costPressure && needs.simple && (cls === "paid" || cls === "unknown")) { score -= 30; why.push("proste zadanie + presja budżetu: płatny (-30)"); }
  return { score, why };
}

/** Sortuj kandydatów (stabilnie; remis → wyższa ranga). Filtr wizji jest twardy. */
export function rankForTask<T extends { provider: ProviderId; model: string; rank: number }>(cands: T[], task: TaskClass, ctx: RankCtx = {}): Ranked<T>[] {
  const needs = TASK_NEEDS[task];
  const pool = needs.vision ? cands.filter((c) => PROFILES[c.provider]?.visionRouting) : cands;
  return pool
    .map((item, i) => ({ item, i, ...scoreCandidate(item.provider, item.model, item.rank, task, ctx) }))
    .sort((a, b) => b.score - a.score || b.item.rank - a.item.rank || a.i - b.i)
    .map(({ item, score, why }) => ({ item, score, why }));
}

// ---------- Dziennik zmian routingu (pierścień) ----------
export interface RoutingChange { at: number; task: TaskClass | string; from: string | null; to: string; reason: string }
const LOG_KEY = "jarvis.autocore.routing.v1";
const LAST_KEY = "jarvis.autocore.lastPrimary.v1";
let log: RoutingChange[] | null = null;
let last: Record<string, string> | null = null;
const L = () => (log ??= loadJson<RoutingChange[]>(LOG_KEY, []));
const LP = () => (last ??= loadJson<Record<string, string>>(LAST_KEY, {}));

export function logRoutingChange(c: RoutingChange): void {
  const l = L(); l.push(c); if (l.length > 200) l.splice(0, l.length - 200); saveJson(LOG_KEY, l);
}
/** Zanotuj wybór głównego (provider/model) dla klasy — loguje TYLKO zmianę. */
export function notePrimary(task: TaskClass, provider: ProviderId, model: string, reason: string, now = Date.now()): boolean {
  const key = `${provider}/${model}`;
  const prev = LP()[task] ?? null;
  if (prev === key) return false;
  LP()[task] = key; saveJson(LAST_KEY, LP());
  logRoutingChange({ at: now, task, from: prev, to: key, reason });
  return true;
}
export const routingLog = (): RoutingChange[] => [...L()];

// ---------- Promocje z eksperymentów + automatyczny rollback ----------
export interface Promotion { task: TaskClass; provider: ProviderId; model: string; previous: { provider: ProviderId; model: string } | null; at: number; okAtPromo: number; koAtPromo: number }
const PROMO_KEY = "jarvis.autocore.promotions.v1";
let promos: Record<string, Promotion> | null = null;
const P = () => (promos ??= loadJson<Record<string, Promotion>>(PROMO_KEY, {}));

export function promote(task: TaskClass, provider: ProviderId, model: string, previous: Promotion["previous"], counters: { ok: number; ko: number }, reason: string, now = Date.now()): void {
  P()[task] = { task, provider, model, previous, at: now, okAtPromo: counters.ok, koAtPromo: counters.ko };
  saveJson(PROMO_KEY, P());
  logRoutingChange({ at: now, task, from: previous ? `${previous.provider}/${previous.model}` : null, to: `${provider}/${model}`, reason: `promocja: ${reason}` });
}
export const promotionFor = (task: TaskClass): Promotion | undefined => P()[task];

/**
 * Rollback: jeśli po promocji model ma ≥3 nowe porażki i więcej porażek niż sukcesów — wróć do poprzedniego.
 * `counters` = bieżące liczniki ok/ko dostawcy (z health). Zwraca true, gdy wycofano.
 */
export function checkRollback(task: TaskClass, counters: { ok: number; ko: number }, now = Date.now()): boolean {
  const pr = P()[task];
  if (!pr) return false;
  const newKo = counters.ko - pr.koAtPromo;
  const newOk = counters.ok - pr.okAtPromo;
  if (newKo >= 3 && newKo > newOk) {
    delete P()[task]; saveJson(PROMO_KEY, P());
    logRoutingChange({ at: now, task, from: `${pr.provider}/${pr.model}`, to: pr.previous ? `${pr.previous.provider}/${pr.previous.model}` : "ranga domyślna", reason: `rollback: ${newKo} porażek vs ${newOk} sukcesów po promocji` });
    return true;
  }
  return false;
}

/** Tylko testy. */
export function resetRouter(): void { log = []; last = {}; promos = {}; saveJson(LOG_KEY, []); saveJson(LAST_KEY, {}); saveJson(PROMO_KEY, {}); }
