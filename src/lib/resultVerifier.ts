// === Weryfikator rezultatu: sprawdź, ZANIM ogłosisz sukces ===
// Dla planów, analiz wysokiego ryzyka i działań z narzędziami: zanim JARVIS powie „zrobione",
// sprawdza ActionOutcome każdego kroku względem successCriteria. CONFIRMED może znaczyć
// wykonanie; DRAFT/SIMULATED/ATTEMPTED — NIE. Przy niskiej pewności mówi, czego nie wiadomo.
// NIE wykonuje ponownie narzędzi. Czyste i testowalne. S9-safe.

import { canClaimSuccess, type ActionOutcome } from "./actionOutcome";

export interface VerifyStep {
  id: string;
  successCriteria?: string;
  outcome: ActionOutcome;
  /** Czy w odpowiedzi padło twierdzenie o sukcesie tego kroku (np. „wysłano")? */
  claimedSuccess?: boolean;
}

export interface VerifyInput {
  goal: string;
  steps: VerifyStep[];
  /** Wykryte sprzeczności (np. z kuratora kontekstu) — przekazywane, nie zgadywane. */
  contradictions?: string[];
}

export interface VerifyResult {
  complete: boolean; // czy wszystkie kroki realnie potwierdzone
  unsupportedClaims: string[]; // twierdzenia o sukcesie bez pokrycia (nie-CONFIRMED)
  missingSteps: string[]; // kroki niewykonane/niepotwierdzone
  contradictions: string[];
  confidence: number; // 0..1
  safeFinalSummary: string; // uczciwe podsumowanie (nie udaje sukcesu)
}

/**
 * Pure: zweryfikuj rezultat planu/akcji. Nie ufa twierdzeniom modelu — patrzy na ActionOutcome.
 */
export function verifyResult(input: VerifyInput): VerifyResult {
  const steps = input.steps || [];
  const unsupportedClaims: string[] = [];
  const missingSteps: string[] = [];
  let confirmed = 0;

  for (const s of steps) {
    const ok = canClaimSuccess(s.outcome); // tylko CONFIRMED
    if (ok) confirmed++;
    else {
      missingSteps.push(s.successCriteria || s.id);
      if (s.claimedSuccess) {
        const state = s.outcome?.state || "DRAFT";
        unsupportedClaims.push(`Krok „${s.successCriteria || s.id}" ogłoszono jako wykonany, a stan to ${state} (brak potwierdzenia).`);
      }
    }
  }

  const contradictions = (input.contradictions || []).slice();
  const complete = steps.length > 0 && confirmed === steps.length && !unsupportedClaims.length && !contradictions.length;

  // Pewność: udział potwierdzonych kroków, karany za fałszywe twierdzenia i sprzeczności.
  let confidence = steps.length ? confirmed / steps.length : 1;
  confidence -= unsupportedClaims.length * 0.25;
  confidence -= contradictions.length * 0.15;
  confidence = Math.max(0, Math.min(1, confidence));

  let safeFinalSummary: string;
  if (complete) {
    safeFinalSummary = "Wszystkie kroki potwierdzone.";
  } else {
    const parts: string[] = [];
    if (missingSteps.length) parts.push(`niepotwierdzone: ${missingSteps.join("; ")}`);
    if (unsupportedClaims.length) parts.push("część ogłoszonych sukcesów nie ma pokrycia");
    if (contradictions.length) parts.push(`sprzeczności: ${contradictions.join("; ")}`);
    safeFinalSummary = `Nie wszystko potwierdzone — ${parts.join(" · ")}.`;
  }

  return { complete, unsupportedClaims, missingSteps, contradictions, confidence, safeFinalSummary };
}

/**
 * Pure: czy w ogóle uruchamiać weryfikator? Nie dla prostego „cześć"/„dodaj mleko".
 * Tak dla: planów wieloetapowych, analiz złożonych, akcji z narzędziami, działań ryzykownych.
 */
export function needsVerification(opts: { complex?: boolean; usedTools?: boolean; riskyAction?: boolean; multiStep?: boolean; veryShort?: boolean }): boolean {
  if (opts.veryShort) return false;
  return !!(opts.riskyAction || opts.multiStep || (opts.complex && opts.usedTools) || (opts.usedTools && opts.riskyAction));
}

// — Runtime: uczciwy werdykt całości po wykonaniu planu/akcji —
// Rozróżnia 5 stanów i NIGDY nie ogłasza „Gotowe" bez dowodu. Deterministyczny (ActionOutcome),
// nie wykonuje narzędzi. Gemini można wpiąć tylko dla semantycznie niejasnego rezultatu (osobno).

/** Końcowy, uczciwy stan działania. */
export type FinalState = "confirmed" | "prepared" | "simulated" | "attempted" | "blocked" | "failed";

export interface RuntimeVerdict {
  state: FinalState;
  /** TYLKO confirmed wolno przedstawić jako sukces ("zrobione/wysłano/zapisano"). */
  canClaimSuccess: boolean;
  confirmed: number;
  total: number;
  summary: string;     // uczciwe zdanie do pokazania (bez ogólnego „Gotowe")
  details: string[];   // krótkie, jawne powody (bez chain-of-thought)
}

export interface RunStepLike {
  id: string;
  intent?: string;
  successCriteria?: string;
  outcome: ActionOutcome;
  skipped?: boolean;
}

/**
 * Pure: zaklasyfikuj wynik wykonania planu na JEDEN uczciwy stan końcowy.
 * Sukces (confirmed) tylko, gdy WSZYSTKIE kroki są CONFIRMED. W innym wypadku zwracamy
 * najbardziej informujący stan blokujący sukces: failed > attempted > simulated > blocked > prepared.
 */
export function verifyRun(input: { goal: string; steps: RunStepLike[] }): RuntimeVerdict {
  const steps = input.steps || [];
  const total = steps.length;
  const confirmed = steps.filter((s) => s.outcome?.state === "CONFIRMED").length;
  const has = (st: string) => steps.some((s) => s.outcome?.state === st);
  const details: string[] = [];
  for (const s of steps) {
    if (s.outcome?.state !== "CONFIRMED") {
      const why = s.skipped ? `pominięto (${s.outcome?.evidence?.message || "blokada"})` : (s.outcome?.state || "DRAFT");
      details.push(`${s.successCriteria || s.intent || s.id}: ${why}`);
    }
  }

  let state: FinalState;
  if (total > 0 && confirmed === total) state = "confirmed";
  else if (has("FAILED")) state = "failed";
  else if (has("ATTEMPTED")) state = "attempted";
  else if (has("SIMULATED")) state = "simulated";
  else if (steps.some((s) => s.skipped)) state = "blocked";
  else state = "prepared";

  const SUMMARY: Record<FinalState, string> = {
    confirmed: `Wykonano i potwierdzono wszystkie kroki (${confirmed}/${total}).`,
    prepared: "Przygotowano (szkic) — nic nie wyszło na zewnątrz; czeka na Twoją decyzję.",
    simulated: "Zasymulowano — NIC nie zostało wysłane ani zapisane na zewnątrz.",
    attempted: `Rozpoczęto — czekam na potwierdzenie skutku; nie ogłaszam sukcesu (${confirmed}/${total} potwierdzonych).`,
    blocked: `Wstrzymano — brak zgody lub niepotwierdzona zależność (${confirmed}/${total} potwierdzonych).`,
    failed: `Nie udało się — część kroków zakończyła się błędem (${confirmed}/${total} potwierdzonych).`,
  };

  return { state, canClaimSuccess: state === "confirmed", confirmed, total, summary: SUMMARY[state], details };
}
