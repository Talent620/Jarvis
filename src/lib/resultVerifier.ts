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
