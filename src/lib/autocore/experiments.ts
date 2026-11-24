// === AUTOCORE · Silnik eksperymentów i porównań modeli ===
// Uruchamia deterministyczne, oceniane mikro-testy po polsku (JSON, logika/arytmetyka, dobór narzędzia)
// w odizolowanej przestrzeni pamięci, domyślnie na modelach darmowych/lokalnych.
// Promocja do routera wymaga: przewagi nad obecnym liderem o >= MIN_MARGIN w >= MIN_RUNS próbach
// oraz braku regresji niezawodności (z późniejszym auto-rollbackiem w router.ts przy awariach).
import { loadJson, saveJson } from "../lsJson";
import type { ProviderId } from "../providers/types";
import { PROVIDERS } from "../providers/registry";
import { costClass } from "./budget";
import { reliabilityOf, providerCounters } from "./health";
import { promote, type TaskClass } from "./router";

const EXP_KEY = "jarvis.autocore.experiments.v1";
export const MIN_MARGIN = 0.15;
export const MIN_RUNS = 2;

export interface EvalCase {
  id: string;
  task: TaskClass;
  prompt: string;
  grade: (output: string) => number; // 0..1
}

export const BENCHMARK_CASES: EvalCase[] = [
  {
    id: "pl-json",
    task: "C_coding",
    prompt: 'Zwróć wyłącznie poprawny JSON bez markdown: {"ok":true,"count":3}',
    grade: (out) => {
      try {
        const clean = out.trim().replace(/^```(?:json)?|```$/g, "").trim();
        const o = JSON.parse(clean) as { ok?: unknown; count?: unknown };
        return o.ok === true && o.count === 3 ? 1 : 0.3;
      } catch { return 0; }
    },
  },
  {
    id: "pl-math",
    task: "A_reasoning",
    prompt: "Ile to jest 17 * 24? Odpowiedz samą liczbą.",
    grade: (out) => (/\b408\b/.test(out) ? 1 : 0),
  },
  {
    id: "pl-tool",
    task: "I_tools",
    prompt: 'Wybierz jedno narzędzie z listy [calendar_add, web_search, timer_set] dla: "Ustaw minutnik na 5 minut". Odpowiedz wyłącznie nazwą narzędzia.',
    grade: (out) => (/timer_set/.test(out) ? 1 : 0),
  },
];

export interface ExperimentRun {
  at: number;
  provider: ProviderId;
  model: string;
  task: TaskClass;
  score: number;
  latencyMs: number;
  ok: boolean;
}

let expCache: ExperimentRun[] | null = null;
const E = (): ExperimentRun[] => (expCache ??= loadJson<ExperimentRun[]>(EXP_KEY, []));

export function experimentHistory(): ExperimentRun[] { return [...E()]; }

export function averageScore(provider: ProviderId, model: string, task?: TaskClass): { avg: number; runs: number } {
  const rows = E().filter((r) => r.provider === provider && r.model === model && (!task || r.task === task));
  if (!rows.length) return { avg: 0, runs: 0 };
  const sum = rows.reduce((s, r) => s + r.score, 0);
  return { avg: sum / rows.length, runs: rows.length };
}

export type EvalRunner = (provider: ProviderId, model: string, prompt: string) => Promise<{ text: string; latencyMs: number }>;

/**
 * Uruchom benchmark dla kandydata. Domyślnie dopuszcza tylko modele local/free
 * (chyba że `allowPaid: true`). Nie używa sekretów ani sieci poza przekazanym runnerem.
 */
export async function runBenchmark(
  provider: ProviderId,
  model: string,
  runner: EvalRunner,
  opts: { allowPaid?: boolean; cases?: EvalCase[]; now?: number } = {},
): Promise<{ skipped?: string; runs: ExperimentRun[]; avgScore: number }> {
  const cls = costClass(provider, model);
  if (!opts.allowPaid && cls !== "local" && cls !== "free") {
    return { skipped: `Pominięto eksperyment na ${provider}/${model} (klasa kosztu: ${cls} — domyślnie tylko darmowe/lokalne).`, runs: [], avgScore: 0 };
  }
  const cases = opts.cases || BENCHMARK_CASES;
  const now = opts.now ?? Date.now();
  const out: ExperimentRun[] = [];
  for (const c of cases) {
    try {
      const res = await runner(provider, model, c.prompt);
      const score = Math.max(0, Math.min(1, c.grade(res.text || "")));
      out.push({ at: now, provider, model, task: c.task, score, latencyMs: res.latencyMs, ok: true });
    } catch {
      out.push({ at: now, provider, model, task: c.task, score: 0, latencyMs: 0, ok: false });
    }
  }
  const storeList = E();
  storeList.push(...out);
  if (storeList.length > 500) storeList.splice(0, storeList.length - 500);
  saveJson(EXP_KEY, storeList);
  const avgScore = out.length ? out.reduce((s, r) => s + r.score, 0) / out.length : 0;
  return { runs: out, avgScore };
}

/**
 * Oceń, czy kandydat może zastąpić lidera dla danej klasy zadań.
 * Wymaga: >= MIN_RUNS prób, przewagi >= MIN_MARGIN oraz braku regresji niezawodności.
 */
export function evaluatePromotion(
  task: TaskClass,
  candidate: { provider: ProviderId; model: string },
  incumbent: { provider: ProviderId; model: string },
  opts: { apply?: boolean; now?: number } = {},
): { promoted: boolean; reason: string } {
  const candStats = averageScore(candidate.provider, candidate.model, task);
  const incStats = averageScore(incumbent.provider, incumbent.model, task);
  if (candStats.runs < MIN_RUNS) return { promoted: false, reason: `Za mało prób kandydata (${candStats.runs}/${MIN_RUNS}).` };
  const baseline = incStats.runs >= 1 ? incStats.avg : 0.5;
  const diff = candStats.avg - baseline;
  if (diff < MIN_MARGIN) return { promoted: false, reason: `Przewaga ${(diff * 100).toFixed(0)}% < próg ${(MIN_MARGIN * 100).toFixed(0)}%.` };
  const relCand = reliabilityOf(candidate.provider);
  const relInc = reliabilityOf(incumbent.provider);
  if (relCand + 0.05 < relInc) return { promoted: false, reason: `Regresja niezawodności (${(relCand * 100).toFixed(0)}% vs ${(relInc * 100).toFixed(0)}%).` };

  const reason = `${PROVIDERS[candidate.provider].label} (${candidate.model}) wygrał ${(candStats.avg * 100).toFixed(0)}% vs ${(baseline * 100).toFixed(0)}%`;
  if (opts.apply) {
    promote(task, candidate.provider, candidate.model, incumbent, providerCounters(candidate.provider), reason, opts.now);
  }
  return { promoted: true, reason };
}

export function resetExperiments(): void { expCache = []; saveJson(EXP_KEY, []); }
