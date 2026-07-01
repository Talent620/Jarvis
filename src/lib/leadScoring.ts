// === Wyjaśnialny ICP score (leadScoring) ===
// Każdy wynik jest ZROZUMIAŁY dla Marcina: 0–100, pewność, TRZY najważniejsze powody, brakujące
// dowody i „najlepsza następna akcja". Brak strony to JEDEN sygnał (potrzeby), a nie cała ocena —
// lead bez strony i bez kontaktu NIE wygrywa automatycznie z aktywną, dobrze dopasowaną firmą.
// Wagi można douczać z realnych wyników, ale w bezpiecznych granicach i z możliwością resetu.
// Czyste i testowalne. S9-safe.

import type { Lead } from "../types";

export interface ScoringSignals {
  offerFit: number;          // 0..1 dopasowanie do oferty
  companyActivity: number;   // 0..1 aktywność firmy
  needSignal: number;        // 0..1 sygnał potrzeby (np. brak/słaba strona)
  potentialValue: number;    // 0..1 (znormalizowana wartość zlecenia)
  contactCompleteness: number; // 0..1
  sourceCredibility: number; // 0..1
  freshness: number;         // 0..1
  competition: number;       // 0..1 (więcej = gorzej)
  risk: number;              // 0..1 (więcej = gorzej)
}

export type NextAction = "research" | "call" | "demo" | "offer" | "reject";

export interface IcpScore {
  score: number;             // 0..100
  confidence: number;        // 0..1
  topReasons: string[];      // 3 najważniejsze
  missingEvidence: string[];
  bestNextAction: NextAction;
}

export type ScoringWeights = Record<keyof ScoringSignals, number>;

// Wagi dodatnie i ujemne (competition/risk odejmują). Suma dodatnich ~1.0.
export const DEFAULT_WEIGHTS: ScoringWeights = {
  offerFit: 0.22,
  companyActivity: 0.14,
  needSignal: 0.14,
  potentialValue: 0.18,
  contactCompleteness: 0.16,
  sourceCredibility: 0.08,
  freshness: 0.08,
  competition: 0.10, // odejmowane
  risk: 0.12,        // odejmowane
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const DAY = 86_400_000;

const LABELS: Record<keyof ScoringSignals, string> = {
  offerFit: "dobre dopasowanie do oferty",
  companyActivity: "firma aktywna",
  needSignal: "wyraźna potrzeba (np. brak/słaba strona)",
  potentialValue: "wysoka potencjalna wartość",
  contactCompleteness: "kompletny kontakt",
  sourceCredibility: "wiarygodne źródło",
  freshness: "świeży lead",
  competition: "duża konkurencja",
  risk: "podwyższone ryzyko",
};

/** Pure: policz wyjaśnialny ICP score z sygnałów. Wynik = suma dodatnich − kary za konkurencję/ryzyko. */
export function scoreLead(signals: ScoringSignals, weights: ScoringWeights = DEFAULT_WEIGHTS): IcpScore {
  const s = signals;
  const positives: (keyof ScoringSignals)[] = ["offerFit", "companyActivity", "needSignal", "potentialValue", "contactCompleteness", "sourceCredibility", "freshness"];
  let raw = 0;
  for (const k of positives) raw += clamp01(s[k]) * weights[k];
  raw -= clamp01(s.competition) * weights.competition;
  raw -= clamp01(s.risk) * weights.risk;
  const score = Math.round(clamp01(raw) * 100);

  // Powody: największe dodatnie wkłady + istotne kary.
  const contributions = positives.map((k) => ({ k, v: clamp01(s[k]) * weights[k] }));
  contributions.sort((a, b) => b.v - a.v);
  const topReasons = contributions.filter((c) => c.v > 0.02).slice(0, 3).map((c) => LABELS[c.k]);
  if (clamp01(s.competition) > 0.6) topReasons.push(LABELS.competition);
  if (clamp01(s.risk) > 0.6) topReasons.push(LABELS.risk);

  // Brakujące dowody: sygnały bliskie zeru (mało danych).
  const missingEvidence: string[] = [];
  if (s.contactCompleteness < 0.3) missingEvidence.push("brak potwierdzonego kontaktu");
  if (s.offerFit < 0.3) missingEvidence.push("słabo znane dopasowanie do oferty");
  if (s.companyActivity < 0.3) missingEvidence.push("brak danych o aktywności firmy");

  // Pewność rośnie z ilością dostępnych danych (im mniej brakuje, tym pewniej).
  const present = [s.offerFit, s.companyActivity, s.contactCompleteness, s.potentialValue, s.sourceCredibility].filter((x) => x >= 0.3).length;
  const confidence = clamp01(0.3 + present * 0.14);

  const bestNextAction = decideNextAction(score, s);
  return { score, confidence: Math.round(confidence * 100) / 100, topReasons: topReasons.slice(0, 3), missingEvidence, bestNextAction };
}

function decideNextAction(score: number, s: ScoringSignals): NextAction {
  if (score < 25) return "reject";
  if (s.contactCompleteness < 0.3) return "research";      // najpierw zdobądź kontakt/dane
  if (s.needSignal >= 0.6 && s.offerFit >= 0.4) return "demo"; // wyraźna potrzeba → pokaż demo
  if (score >= 65 && s.contactCompleteness >= 0.5) return "offer";
  return "call";
}

/** Pure: wyprowadź sygnały z leada (brak strony = JEDEN sygnał potrzeby, nie cała ocena). */
export function signalsFromLead(lead: Lead, now: number): ScoringSignals {
  const hasEmail = !!lead.email;
  const hasPhone = !!(lead.contact && !lead.contact.includes("@")) || !!lead.contact;
  const contactCompleteness = clamp01((hasEmail ? 0.6 : 0) + (hasPhone ? 0.4 : 0));
  const audit = lead.intel?.audit;
  // Potrzeba: brak strony = 0.7 (potrzebują), słaba strona = 0.5, dobra = 0.2.
  let needSignal = 0.2;
  if (!lead.url) needSignal = 0.7;
  else if (audit?.ok && (audit.viewport === false || audit.https === false || audit.metaDesc === false)) needSignal = 0.5;
  const companyActivity = clamp01((lead.url ? 0.5 : 0.2) + (lead.hours ? 0.2 : 0) + ((lead.followUpCount || 0) > 0 ? 0.2 : 0) + (lead.lastContactedAt && now - lead.lastContactedAt < 30 * DAY ? 0.2 : 0));
  const offerFit = clamp01(lead.niche ? 0.6 : 0.4);
  const potentialValue = clamp01(typeof lead.value === "number" ? Math.min(1, lead.value / 15000) : 0.4);
  const sourceCredibility = lead.origin === "salesos" ? 0.9 : 0.7;
  const freshness = clamp01(1 - Math.min(1, (now - (lead.updatedAt || lead.createdAt || now)) / (30 * DAY)));
  const risk = lead.status === "lost" ? 0.8 : 0.2;
  return { offerFit, companyActivity, needSignal, potentialValue, contactCompleteness, sourceCredibility, freshness, competition: 0.4, risk };
}

// — Douczanie wag z realnych wyników (bezpieczne granice + reset) —
const WEIGHT_MIN_FACTOR = 0.5;
const WEIGHT_MAX_FACTOR = 2;
const LEARN_STEP = 0.05;

/** Pure: delikatnie douczaj wagę sygnału na podstawie POTWIERDZONEGO wyniku (won/lost). Granice bezpieczne. */
export function adjustWeight(weights: ScoringWeights, signal: keyof ScoringSignals, won: boolean): ScoringWeights {
  const base = DEFAULT_WEIGHTS[signal];
  const next = { ...weights };
  const delta = won ? LEARN_STEP : -LEARN_STEP;
  next[signal] = Math.max(base * WEIGHT_MIN_FACTOR, Math.min(base * WEIGHT_MAX_FACTOR, weights[signal] + delta));
  return next;
}

/** Pure: reset wag do domyślnych. */
export function resetWeights(): ScoringWeights {
  return { ...DEFAULT_WEIGHTS };
}
