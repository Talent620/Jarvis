// === Kontrakt prawdy działania (ActionOutcome) ===
// Jedno źródło prawdy o skutku KAŻDEJ operacji zewnętrznej/biznesowej. JARVIS nie może
// twierdzić, że coś WYSŁAŁ / ZAPISAŁ / OPŁACIŁ, jeśli nie ma na to dowodu. UI bierze etykietę
// wyłącznie stąd. Czyste i testowalne — bez efektów ubocznych.

/**
 * Stany skutku działania:
 *  - DRAFT      — tylko przygotowano (nic nie ruszyło na zewnątrz);
 *  - SIMULATED  — zasymulowano (mock/tryb demo) — NIC nie wyszło na zewnątrz;
 *  - ATTEMPTED  — rozpoczęto, brak potwierdzenia dostarczenia;
 *  - CONFIRMED  — dostawca/system potwierdził skutek;
 *  - FAILED     — potwierdzony błąd.
 */
export type OutcomeState = "DRAFT" | "SIMULATED" | "ATTEMPTED" | "CONFIRMED" | "FAILED";

export interface OutcomeEvidence {
  providerId?: string; // id u dostawcy (np. message-id SMTP), jeśli jest
  confirmedAt?: number; // znacznik potwierdzenia
  source?: string; // kanał/dostawca (smtp, gmail, salesos, mock…)
  manual?: boolean; // potwierdzone ręcznie przez użytkownika (a nie przez system)
  message?: string; // krótki opis dla człowieka
}

export interface ActionOutcome {
  state: OutcomeState;
  evidence?: OutcomeEvidence;
}

/** TYLKO te stany wolno przedstawić jako sukces ("wysłano/zapisano/opłacono"). */
export function canClaimSuccess(o: ActionOutcome | null | undefined): boolean {
  return !!o && o.state === "CONFIRMED";
}

/** Czy operacja jest definitywnie zakończona (sukces lub błąd)? */
export function isTerminal(o: ActionOutcome | null | undefined): boolean {
  return !!o && (o.state === "CONFIRMED" || o.state === "FAILED");
}

const LABELS: Record<OutcomeState, string> = {
  DRAFT: "Szkic",
  SIMULATED: "Symulacja (nic nie wysłano)",
  ATTEMPTED: "Wysłano — czekam na potwierdzenie",
  CONFIRMED: "Potwierdzone",
  FAILED: "Błąd",
};

/** Bezpieczna etykieta do UI — nigdy nie udaje sukcesu dla DRAFT/SIMULATED/ATTEMPTED. */
export function outcomeLabel(o: ActionOutcome | null | undefined): string {
  if (!o) return LABELS.DRAFT;
  const base = LABELS[o.state];
  if (o.state === "CONFIRMED" && o.evidence?.manual) return "Potwierdzone (ręcznie)";
  return base;
}

/** Ikona statusu (spójna w całej apce). */
export function outcomeIcon(o: ActionOutcome | null | undefined): string {
  switch (o?.state) {
    case "CONFIRMED": return "✅";
    case "FAILED": return "❌";
    case "ATTEMPTED": return "⏳";
    case "SIMULATED": return "🧪";
    default: return "✍";
  }
}

// — Konstruktory (czytelne, niemutowalne) —
export const draft = (message?: string): ActionOutcome => ({ state: "DRAFT", evidence: message ? { message } : undefined });
export const simulated = (message?: string): ActionOutcome => ({ state: "SIMULATED", evidence: { source: "mock", message } });
export const attempted = (source?: string, message?: string): ActionOutcome => ({ state: "ATTEMPTED", evidence: { source, message } });
export const confirmed = (ev: OutcomeEvidence = {}): ActionOutcome => ({ state: "CONFIRMED", evidence: { ...ev, confirmedAt: ev.confirmedAt } });
export const failed = (message?: string, source?: string): ActionOutcome => ({ state: "FAILED", evidence: { source, message } });

/**
 * Adapter zgodności ze starymi wynikami boolean ({ ok, error, via } itp.).
 * ok===true → CONFIRMED (z dowodem via/providerId); ok===false → FAILED.
 * Pozwala stopniowo migrować kod bez łamania istniejącego API.
 */
export function legacyOutcome(
  legacy: { ok?: boolean; sent?: boolean; error?: string; via?: string; providerId?: string; simulated?: boolean } | boolean | null | undefined,
  now: number,
): ActionOutcome {
  if (legacy == null) return draft();
  if (typeof legacy === "boolean") return legacy ? confirmed({ confirmedAt: now }) : failed();
  if (legacy.simulated) return simulated(legacy.error);
  const ok = legacy.ok ?? legacy.sent;
  if (ok === true) return confirmed({ confirmedAt: now, source: legacy.via, providerId: legacy.providerId });
  if (ok === false) return failed(legacy.error, legacy.via);
  return draft(legacy.error);
}
