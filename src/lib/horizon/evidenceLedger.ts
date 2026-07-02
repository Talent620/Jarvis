// === Rejestr Dowodów (Cross-Device Flight Recorder) ===
// Jeden kwit na akcję, spięty jednym traceId „od słowa do diody". Append-only,
// idempotentny po correlationId (ten sam correlationId nie tworzy drugiego kwitu —
// „wyślij-raz" widoczne też w dowodach). Czysty: funkcje zwracają NOWĄ tablicę tylko
// gdy faktycznie coś dopisano (idempotencja referencji, ważne dla store S9).
import type { EvidenceEntry, StepResult, Mission } from "./types";

/** Deterministyczny traceId misji (bez losowości — stabilny w testach i resumach). */
export function missionTraceId(missionId: string): string {
  return `trace:${missionId}`;
}

/**
 * Dopisz kwit za wynik kroku. Idempotentnie: jeśli w rejestrze jest już wpis o tym
 * samym correlationId ORAZ stanie, zwraca tę samą tablicę (nic nie dopisuje).
 * Zmiana stanu tego samego correlationId (np. ATTEMPTED→CONFIRMED po weryfikacji)
 * JEST dopisywana — to kolejny, prawdziwy fakt w łańcuchu dowodowym.
 */
export function appendEvidence(
  ledger: EvidenceEntry[],
  mission: Mission,
  result: StepResult,
  correlationId: string,
  capability: string,
  now: number,
): EvidenceEntry[] {
  const dup = ledger.some(
    (e) => e.correlationId === correlationId && e.state === result.outcome.state && e.stepId === result.stepId,
  );
  if (dup) return ledger; // ten sam fakt już zapisany — bez duplikatu (idempotencja)
  const entry: EvidenceEntry = {
    traceId: missionTraceId(mission.id),
    missionId: mission.id,
    stepId: result.stepId,
    correlationId,
    node: result.node,
    capability,
    state: result.outcome.state,
    at: now,
    readback: result.readback,
    message: result.outcome.evidence?.message,
  };
  return [...ledger, entry];
}

/** Wszystkie kwity danej misji, w kolejności zapisu. Czyste. */
export function evidenceForMission(ledger: EvidenceEntry[], missionId: string): EvidenceEntry[] {
  return ledger.filter((e) => e.missionId === missionId);
}

/** Czy correlationId ma już kwit w stanie CONFIRMED (zabezpieczenie „wyślij-raz"). */
export function isCorrelationConfirmed(ledger: EvidenceEntry[], correlationId: string): boolean {
  return ledger.some((e) => e.correlationId === correlationId && e.state === "CONFIRMED");
}

/** Czytelny łańcuch dowodowy dla człowieka („po katastrofie odtwórz głosem"). */
export function evidenceStory(ledger: EvidenceEntry[], missionId: string): string[] {
  return evidenceForMission(ledger, missionId).map((e) => {
    const kto = e.node === "phone" ? "telefon" : e.node === "exe" ? "komputer" : "urządzenie";
    return `${kto} · ${e.capability} · ${e.state}${e.message ? ` (${e.message})` : ""}`;
  });
}
