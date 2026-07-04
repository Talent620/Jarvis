// === Polityka samonaprawy (recovery) ===
// Gdy krok planu padnie, JARVIS reaguje BEZPIECZNIE: rozpoznaje rodzaj błędu i wybiera działanie.
// Chwilowy błąd sieci / 429 → ograniczony retry z backoff. Zły argument / zły plan → poproś o
// naprawę WYŁĄCZNIE pozostałych kroków. Brak danych / niejasność → spytaj użytkownika. Trwały błąd
// → przerwij z czytelnym powodem. KLUCZOWE: działań nieodwracalnych (mail, płatność, publikacja,
// usuwanie = outbound) NIGDY nie ponawiamy automatycznie — inaczej grozi podwójne działanie.
// Czyste i testowalne. S9-safe (jawne wzorce, bez /u, \p, lookbehind).

import type { Risk } from "./permissions";

export type ErrorKind =
  | "transient_network" // chwilowy błąd sieci/timeout
  | "quota_429"         // limit / rate-limit
  | "bad_argument"      // zły argument / 400 / walidacja
  | "missing_data"      // brak wymaganych danych / 404
  | "consent_denied"    // użytkownik nie wyraził zgody
  | "permanent_service" // trwały błąd usługi (500/401/403/not implemented)
  | "unknown";

export type RecoveryAction =
  | "retry_backoff"     // ponów po odczekaniu (tylko bezpieczne, nie-outbound)
  | "replan_remaining"  // popraw plan, ale TYLKO pozostałe kroki
  | "ask_user"          // zapytaj o brakującą informację / decyzję
  | "skip"              // pomiń krok (np. odmowa zgody) — bez ponawiania
  | "abort";            // przerwij cel z czytelnym powodem

export interface RecoveryDecision {
  action: RecoveryAction;
  retryable: boolean;
  delayMs: number;   // backoff dla TEJ próby (0 gdy brak retry)
  reason: string;    // czytelny powód (zapisywany przy zmianie planu)
  attempt: number;   // której to próby dotyczy (0-based)
  maxAttempts: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY = 2000;
const MAX_DELAY = 16000;

/** Pure: rozpoznaj rodzaj błędu po komunikacie/statusie (S9-safe, bez /u). */
export function classifyError(err: unknown): ErrorKind {
  const status = typeof (err as { status?: number })?.status === "number" ? (err as { status: number }).status : undefined;
  const msg = (err instanceof Error ? err.message : typeof err === "string" ? err : "").toLowerCase();

  if (status === 429 || /\b429\b|too many requests|rate limit|quota|przekroczono limit/.test(msg)) return "quota_429";
  if (status === 400 || /\b400\b|invalid argument|bad request|zły argument|zly argument|nieprawidłow|nieprawidlow|validation/.test(msg)) return "bad_argument";
  if (status === 404 || /\b404\b|not found|brak danych|missing|nie znaleziono/.test(msg)) return "missing_data";
  if (/zgod|consent|denied|anulowano|odmow|unauthor/.test(msg) && status !== 401 && status !== 403) return "consent_denied";
  if (status === 401 || status === 403 || status === 500 || status === 501 || /\b50[01]\b|not implemented|forbidden|unauthorized|trwały błąd|trwaly blad/.test(msg)) return "permanent_service";
  if (status === 502 || status === 503 || status === 504 || /\b50[234]\b|network|fetch failed|timeout|timed out|econn|etimedout|offline|temporarily unavailable|chwilow/.test(msg)) return "transient_network";
  return "unknown";
}

/** Pure: backoff wykładniczy z górnym limitem. */
export function backoffMs(attempt: number): number {
  return Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, Math.max(0, attempt)));
}

/**
 * Pure: zdecyduj, co zrobić z błędem kroku. Outbound (mail/płatność/publikacja/usuwanie) NIGDY
 * nie jest ponawiany automatycznie — przy chwilowym błędzie outbound pytamy użytkownika.
 */
export function decideRecovery(opts: { kind: ErrorKind; risk: Risk; attempt: number; maxAttempts?: number }): RecoveryDecision {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const isOutbound = opts.risk === "outbound";
  const base = { attempt: opts.attempt, maxAttempts };

  switch (opts.kind) {
    case "transient_network":
    case "quota_429": {
      // Outbound: zakaz auto-ponawiania (ryzyko podwójnego działania) → decyzja użytkownika.
      if (isOutbound) return { ...base, action: "ask_user", retryable: false, delayMs: 0, reason: `Błąd przy akcji zewnętrznej (${opts.kind}) — nie ponawiam automatycznie, by nie zadziałać dwa razy. Poproszę o decyzję.` };
      if (opts.attempt + 1 < maxAttempts) return { ...base, action: "retry_backoff", retryable: true, delayMs: backoffMs(opts.attempt), reason: `Chwilowy błąd (${opts.kind}) — ponawiam za ${backoffMs(opts.attempt)} ms (próba ${opts.attempt + 2}/${maxAttempts}).` };
      return { ...base, action: "abort", retryable: false, delayMs: 0, reason: `Chwilowy błąd (${opts.kind}) utrzymuje się po ${maxAttempts} próbach — przerywam.` };
    }
    case "bad_argument":
      return { ...base, action: "replan_remaining", retryable: false, delayMs: 0, reason: "Zły argument kroku — proszę o naprawę WYŁĄCZNIE pozostałych kroków planu (cel bez zmian)." };
    case "missing_data":
      return { ...base, action: "ask_user", retryable: false, delayMs: 0, reason: "Brak wymaganych danych — zadam jedno konkretne pytanie zamiast działać po omacku." };
    case "consent_denied":
      return { ...base, action: "skip", retryable: false, delayMs: 0, reason: "Brak zgody użytkownika — pomijam krok bez ponawiania." };
    case "permanent_service":
      return { ...base, action: "abort", retryable: false, delayMs: 0, reason: "Trwały błąd usługi — przerywam i zgłaszam (model i tak ma failover na poziomie dostawcy)." };
    default:
      return { ...base, action: "ask_user", retryable: false, delayMs: 0, reason: "Nieznany błąd — pytam użytkownika, zamiast zgadywać." };
  }
}

/** Czy ten rodzaj akcji wolno w ogóle automatycznie ponowić? (czytelny strażnik dla outbound). */
export function mayAutoRetry(kind: ErrorKind, risk: Risk): boolean {
  if (risk === "outbound") return false;
  return kind === "transient_network" || kind === "quota_429";
}
