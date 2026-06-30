// === Cele wynikowe i mierzalny postęp (goalGraph) ===
// Cel JARVIS-a ma MIERZALNY rezultat, a postęp wynika z DANYCH (finanse, leady, projekty), nie z
// deklaracji modelu. Gemini może zaproponować metrykę/cel, ale liczy je deterministyczny silnik —
// dzięki temu JARVIS wie, czy jego działania naprawdę przybliżyły Marcina do celu. Połączone z
// realnymi zdarzeniami: nowy lead, wygrany klient, ukończony projekt, wpłata. Reużywa financeKpis
// (jedno źródło prawdy finansów). Czyste i testowalne. S9-safe (jawne klasy, bez /u, \p, lookbehind).

import { financeKpis } from "./finance";
import type { Lead, FinanceProject } from "../types";

export type GoalMetric = "revenue" | "payments" | "clients_won" | "leads" | "project_done" | "custom";

export interface OutcomeGoal {
  id: string;
  desiredOutcome: string;
  metric: GoalMetric;
  baseline: number;
  target: number;
  deadline?: number;          // ms
  constraints?: string[];
  linkedEntities?: string[];  // id leadów/projektów/klientów powiązanych z celem
  createdAt: number;
}

export interface GoalProgress {
  current: number;
  baseline: number;
  target: number;
  pct: number;        // 0..1 od baseline do target
  reached: boolean;
  remaining: number;
  overdue: boolean;   // po terminie i nieosiągnięty
  note: string;       // krótkie, jawne zdanie (bez chain-of-thought)
}

export interface MetricSources {
  finance?: FinanceProject[];
  leads?: Lead[];
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Pure: aktualna wartość metryki z DANYCH (deterministycznie). Anulowane projekty są wyłączone
 * (przez financeKpis). „custom" liczymy z liczby powiązanych encji lub 0 (nie zgadujemy).
 */
export function computeMetricValue(metric: GoalMetric, src: MetricSources, opts: { since?: number } = {}): number {
  const finance = src.finance || [];
  const leads = src.leads || [];
  const since = opts.since;
  const inWindow = (at?: number): boolean => (since == null ? true : (at || 0) >= since);

  switch (metric) {
    case "revenue":
      return financeKpis(finance).revenue;              // przychód rozpoznany (bez anulowanych)
    case "payments":
      return financeKpis(finance).paid;                  // realnie wpłacone (częściowe też liczą)
    case "clients_won":
      return leads.filter((l) => l.status === "won" && inWindow(l.updatedAt)).length;
    case "leads":
      return leads.filter((l) => inWindow(l.createdAt)).length;
    case "project_done":
      return financeKpis(finance).doneCount;             // ukończone/zamknięte (anulowane wyłączone)
    default:
      return 0;
  }
}

/**
 * Pure: postęp celu = ile drogi od baseline do target pokonano. Postęp z danych, nie z deklaracji.
 * Cel osiągnięty, gdy current >= target. overdue, gdy po terminie i nieosiągnięty.
 */
export function computeProgress(goal: OutcomeGoal, current: number, now: number): GoalProgress {
  const span = goal.target - goal.baseline;
  const pct = span === 0 ? (current >= goal.target ? 1 : 0) : clamp01((current - goal.baseline) / span);
  const reached = current >= goal.target;
  const remaining = Math.max(0, goal.target - current);
  const overdue = !!goal.deadline && now > goal.deadline && !reached;
  const note = reached
    ? `Cel osiągnięty: ${current}/${goal.target}.`
    : overdue
    ? `Po terminie — brakuje ${remaining} (${Math.round(pct * 100)}%).`
    : `Postęp ${Math.round(pct * 100)}% — brakuje ${remaining} do celu ${goal.target}.`;
  return { current, baseline: goal.baseline, target: goal.target, pct, reached, remaining, overdue, note };
}

/** Pure: wylicz postęp wprost z DANYCH (łączy computeMetricValue + computeProgress). */
export function progressFromData(goal: OutcomeGoal, src: MetricSources, now: number): GoalProgress {
  const current = goal.metric === "custom" ? goal.baseline : computeMetricValue(goal.metric, src, { since: goal.createdAt });
  return computeProgress(goal, current, now);
}

// — Propozycja metryki/celu z języka (lokalnie; Gemini może doprecyzować, ale silnik liczy sam) —

const METRIC_CUES: { re: RegExp; metric: GoalMetric }[] = [
  { re: /\b(przychod|przychód|sprzeda|zarob|utarg|obrot|obrót|revenue)\w*/i, metric: "revenue" },
  { re: /\b(wpłat|wplat|płatnoś|platnos|zapłat|zaplat|gotówk|gotowk|zaliczk|należnoś|naleznos)\w*/i, metric: "payments" },
  { re: /\b(klient|klientów|klientow|won|wygra)\w*/i, metric: "clients_won" },
  { re: /\b(lead|leady|leadów|leadow)\w*/i, metric: "leads" },
  { re: /\b(projekt|domkn|ukończ|ukoncz|zamkn|finaliz)\w*/i, metric: "project_done" },
];

/** Pure: zaproponuj metrykę z treści celu (heurystyka lokalna). */
export function suggestMetric(text: string): GoalMetric {
  const t = text || "";
  for (const c of METRIC_CUES) if (c.re.test(t)) return c.metric;
  return "custom";
}

/** Pure: pierwsza liczba całkowita w tekście (S9-safe) — np. „zdobądź 5 klientów" → 5. */
export function extractTarget(text: string): number | undefined {
  const m = /(\d[\d\s]*)/.exec((text || "").replace(/ /g, " "));
  if (!m) return undefined;
  const n = Number(m[1].replace(/\s+/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Pure: zbuduj cel wynikowy z polecenia (np. „zdobądź 5 klientów", „zwiększ przychód", „domknij projekt").
 * baseline = bieżąca wartość metryki w danych (start liczymy od stanu faktycznego, nie od zera „na oko").
 */
export function buildOutcomeGoal(
  text: string,
  opts: { id: string; now: number; src?: MetricSources; deadline?: number; target?: number },
): OutcomeGoal {
  const metric = suggestMetric(text);
  const baseline = metric === "custom" ? 0 : computeMetricValue(metric, opts.src || {}, {});
  const parsed = opts.target ?? extractTarget(text);
  // Sensowne domyślne cele, gdy liczby brak: revenue → baseline+1000; liczniki → baseline+1.
  const target = parsed != null ? parsed : metric === "revenue" || metric === "payments" ? baseline + 1000 : baseline + 1;
  return {
    id: opts.id,
    desiredOutcome: (text || "").trim(),
    metric,
    baseline,
    target,
    deadline: opts.deadline,
    linkedEntities: [],
    createdAt: opts.now,
  };
}
