// === Pętla uczenia (learningLoop): korekty + rezultaty ===
// JARVIS z czasem pracuje lepiej dla Marcina, ale POZOSTAJE kontrolowalny. Uczy się z DWÓCH źródeł:
// 1) jawnych korekt użytkownika („nie tak", „zawsze rób…", „nie wysyłaj…", „wolę…") — jednorazowa
//    korekta NIE staje się automatycznie globalną regułą; dopiero po powtórzeniu proponujemy trwałą
//    preferencję, a użytkownik ją akceptuje/odrzuca/usuwa; 2) POTWIERDZONYCH rezultatów działań
//    (odpowiedź klienta, wygrana, płatność) — NIGDY z SIMULATED ani niepotwierdzonego sukcesu.
// Nie modyfikujemy promptu systemowego ani kodu. Czyste i testowalne. S9-safe (bez /u, \p, lookbehind).

import { canClaimSuccess, type ActionOutcome } from "./actionOutcome";

export type CorrectionKind = "negative" | "always" | "never" | "prefer";
export type CorrectionScope = "candidate" | "rule"; // candidate = jednorazowa; rule = trwała (po akceptacji)

export interface Correction {
  id: string;
  kind: CorrectionKind;
  directive: string;   // znormalizowana treść (klucz do dedupu/powtórzeń)
  source: string;      // skąd (np. „czat")
  scope: CorrectionScope;
  count: number;       // ile razy zaobserwowana
  active: boolean;     // czy reguła obowiązuje (tylko po akceptacji)
  createdAt: number;
  lastSeenAt: number;
}

const norm = (s: string): string => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Uwaga S9: NIE używamy trailing \b — polskie słowa kończą się na ę/ó (znaki spoza \w),
// więc granica po nich nie zachodzi i wzorzec by nie trafiał. Dopasowujemy frazę bez prawej granicy.
const NEVER_RE = /\b(nie wysyłaj|nie wysylaj|nie rób|nie rob|nie dzwoń|nie dzwon|nie pisz|nigdy nie|przestań|przestan)/;
const ALWAYS_RE = /\bzawsze/;
const PREFER_RE = /\b(wolę|wole|preferuję|preferuje|lepiej żeby|lepiej zeby|najlepiej)/;
const NEGATIVE_RE = /\b(nie tak|źle|zle|nie o to|to nie to|pomyłka|pomylka|popraw to|nie tego)/;

export interface DetectedCorrection {
  kind: CorrectionKind;
  directive: string;
}

/** Pure: wykryj jawną korektę użytkownika (lub null). Kolejność: never/always/prefer przed „negative". */
export function detectCorrection(text: string): DetectedCorrection | null {
  const t = norm(text);
  if (!t) return null;
  if (NEVER_RE.test(t)) return { kind: "never", directive: t };
  if (ALWAYS_RE.test(t)) return { kind: "always", directive: t };
  if (PREFER_RE.test(t)) return { kind: "prefer", directive: t };
  if (NEGATIVE_RE.test(t)) return { kind: "negative", directive: t };
  return null;
}

const sameDirective = (a: string, b: string): boolean => {
  const na = norm(a), nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
};

export interface UpsertResult {
  list: Correction[];
  /** Gdy korekta powtórzyła się ≥2× — propozycja utrwalenia (wymaga akceptacji użytkownika). */
  proposal?: Correction;
}

/**
 * Pure: zapisz wykrytą korektę. Jednorazowa = candidate (NIE reguła). Po powtórzeniu (count>=2)
 * zwracamy `proposal` do potwierdzenia — bez akceptacji NIC nie staje się obowiązującą regułą.
 */
export function upsertCorrection(list: Correction[], det: DetectedCorrection, opts: { id: string; source: string; now: number }): UpsertResult {
  const existing = list.find((c) => c.kind === det.kind && sameDirective(c.directive, det.directive));
  if (existing) {
    const updated: Correction = { ...existing, count: existing.count + 1, lastSeenAt: opts.now };
    const next = list.map((c) => (c.id === existing.id ? updated : c));
    const proposal = updated.count >= 2 && updated.scope === "candidate" && !updated.active ? updated : undefined;
    return { list: next, proposal };
  }
  const fresh: Correction = {
    id: opts.id, kind: det.kind, directive: det.directive, source: opts.source,
    scope: "candidate", count: 1, active: false, createdAt: opts.now, lastSeenAt: opts.now,
  };
  return { list: [...list, fresh] };
}

/** Pure: zaakceptuj propozycję → trwała, obowiązująca reguła (kontrola po stronie użytkownika). */
export function acceptCorrection(list: Correction[], id: string, now: number): Correction[] {
  return list.map((c) => (c.id === id ? { ...c, scope: "rule", active: true, lastSeenAt: now } : c));
}

/** Pure: usuń nauczoną regułę/korektę (pełna kontrola — można cofnąć naukę). */
export function removeCorrection(list: Correction[], id: string): Correction[] {
  return list.filter((c) => c.id !== id);
}

/** Pure: obowiązujące reguły (tylko zaakceptowane). */
export function activeRules(list: Correction[]): Correction[] {
  return list.filter((c) => c.scope === "rule" && c.active);
}

/**
 * Pure: wykryj KONFLIKT między nową preferencją a już obowiązującą regułą (sprzeczne „wolę/zawsze"
 * dotyczące tego samego tematu). Nie rozstrzygamy po cichu — zwracamy konflikt do decyzji użytkownika.
 */
export function detectConflict(list: Correction[], det: DetectedCorrection): Correction | null {
  if (det.kind !== "prefer" && det.kind !== "always") return null;
  for (const r of activeRules(list)) {
    if (r.kind !== "prefer" && r.kind !== "always") continue;
    // Wspólny temat (jedno słowo-klucz powtarza się), ale różna treść → konflikt.
    if (!sameDirective(r.directive, det.directive) && sharesTopic(r.directive, det.directive)) return r;
  }
  return null;
}

const STOP = new Set(["nie", "tak", "się", "sie", "to", "o", "i", "w", "na", "z", "do", "że", "ze", "mi", "by", "zawsze", "wolę", "wole", "lepiej"]);
function sharesTopic(a: string, b: string): boolean {
  const wa = new Set(norm(a).split(/[^a-z0-9ąćęłńóśźż]+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const wb = norm(b).split(/[^a-z0-9ąćęłńóśźż]+/).filter((w) => w.length > 2 && !STOP.has(w));
  return wb.some((w) => wa.has(w));
}

// — Uczenie z REZULTATÓW (tylko potwierdzone) —

export type OutcomeSignal = "client_replied" | "offer_won" | "payment" | "no_effect";

export interface ActionStat {
  actionType: string;
  positives: number;
  negatives: number;
  weight: number;    // -1..1 — skłonność (bounded), do delikatnego rankingu sugestii
  updatedAt: number;
}

const WEIGHT_STEP = 0.15;
const clampW = (x: number): number => Math.max(-1, Math.min(1, x));

/** Pure: czy WOLNO uczyć się z tego rezultatu? Tylko POTWIERDZONY (CONFIRMED). Nigdy z symulacji. */
export function canLearnFromOutcome(outcome: ActionOutcome | null | undefined): boolean {
  return canClaimSuccess(outcome); // tylko CONFIRMED
}

/**
 * Pure: zaktualizuj statystykę akcji na podstawie POTWIERDZONEGO rezultatu. SIMULATED/ATTEMPTED/DRAFT
 * są ignorowane (zwracamy listę bez zmian). Wagi są ograniczone i odwracalne (reset = usunięcie).
 */
export function learnFromOutcome(
  stats: ActionStat[],
  input: { actionType: string; outcome: ActionOutcome; signal: OutcomeSignal; now: number },
): ActionStat[] {
  if (!canLearnFromOutcome(input.outcome)) return stats; // nie uczymy z niepotwierdzonego
  const positive = input.signal === "offer_won" || input.signal === "payment" || input.signal === "client_replied";
  const cur = stats.find((s) => s.actionType === input.actionType);
  const base: ActionStat = cur || { actionType: input.actionType, positives: 0, negatives: 0, weight: 0, updatedAt: input.now };
  const updated: ActionStat = {
    ...base,
    positives: base.positives + (positive ? 1 : 0),
    negatives: base.negatives + (positive ? 0 : 1),
    weight: clampW(base.weight + (positive ? WEIGHT_STEP : -WEIGHT_STEP)),
    updatedAt: input.now,
  };
  return cur ? stats.map((s) => (s.actionType === input.actionType ? updated : s)) : [...stats, updated];
}
