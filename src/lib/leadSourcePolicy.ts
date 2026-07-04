// === Zgodność źródeł i możliwości kontaktu (leadSourcePolicy) ===
// System ma DOWÓD, skąd pochodzą dane i DLACZEGO dana akcja jest lub nie jest dozwolona. Publiczny
// e-mail NIE oznacza automatycznej zgody na kampanię — bez potwierdzonej możliwości kontaktu JARVIS
// może przygotować DRAFT, ale nie wyśle automatycznie. Nie deklarujemy „zgodne z prawem" — pokazujemy
// stan „wymaga potwierdzenia". Do tego uczciwe limitowanie zapytań (Nominatim 1 req/s, backoff,
// cache) zgodne z polityką OSM. Czyste i testowalne. S9-safe.

export type ContactPermission = "unknown" | "requires_confirmation" | "confirmed" | "opted_out";

export interface SourceEvidence {
  source: string;
  sourceUrl?: string;
  fetchedAt: number;
  removable: true; // dane źródłowe zawsze można usunąć
}

export interface ContactPolicyInput {
  hasEmail?: boolean;
  hasPhone?: boolean;
  optOut?: boolean;
  doNotContact?: boolean;
  contactConfirmed?: boolean; // użytkownik potwierdził podstawę kontaktu
}

export interface ContactPolicy {
  permission: ContactPermission;
  doNotContact: boolean;
  legalBasisNote: string;      // NIGDY „zgodne z prawem" — zawsze stan do potwierdzenia
  suppressionReason?: string;
  canAutoSend: boolean;        // tylko potwierdzone i bez blokad
  canDraft: boolean;           // draft prawie zawsze wolno przygotować
}

/**
 * Pure: oceń możliwość kontaktu. Publiczny e-mail → „wymaga potwierdzenia" (NIE zgoda). doNotContact
 * / optOut blokują AUTO-wysyłkę, ale DRAFT nadal można przygotować. Auto-send tylko po potwierdzeniu.
 */
export function evaluateContactPolicy(input: ContactPolicyInput): ContactPolicy {
  const blocked = !!input.doNotContact || !!input.optOut;
  let permission: ContactPermission;
  if (input.optOut) permission = "opted_out";
  else if (input.contactConfirmed) permission = "confirmed";
  else if (input.hasEmail || input.hasPhone) permission = "requires_confirmation";
  else permission = "unknown";

  const canAutoSend = permission === "confirmed" && !blocked;
  const suppressionReason = input.doNotContact ? "oznaczone doNotContact" : input.optOut ? "kontakt wypisał się (opt-out)" : undefined;

  return {
    permission,
    doNotContact: !!input.doNotContact,
    legalBasisNote: canAutoSend
      ? "Podstawa kontaktu potwierdzona przez użytkownika."
      : "Wymaga potwierdzenia podstawy kontaktu — publiczny kontakt to nie zgoda na kampanię.",
    suppressionReason,
    canAutoSend,
    canDraft: !input.optOut, // po opt-out nie tworzymy nawet draftu; doNotContact wciąż pozwala na draft
  };
}

/** Pure: zbuduj dowód pochodzenia danych (do audytu i możliwości usunięcia). */
export function buildSourceEvidence(source: string, now: number, sourceUrl?: string): SourceEvidence {
  return { source, sourceUrl, fetchedAt: now, removable: true };
}

// — Limitowanie zapytań do źródeł (OSM Nominatim: maks. 1/s; Overpass: backoff) —

export interface RateState {
  lastAt: number;      // ostatnie zapytanie
  failures: number;    // kolejne błędy → backoff
}

export const NOMINATIM_MIN_INTERVAL_MS = 1000; // polityka OSM: max 1 req/s
const MAX_BACKOFF_MS = 30_000;

/** Pure: ile ms trzeba jeszcze odczekać do kolejnego zapytania (0 = można od razu). */
export function delayUntilAllowed(state: RateState, now: number, minInterval = NOMINATIM_MIN_INTERVAL_MS): number {
  const backoff = state.failures > 0 ? Math.min(MAX_BACKOFF_MS, minInterval * Math.pow(2, state.failures)) : minInterval;
  const elapsed = now - state.lastAt;
  return Math.max(0, backoff - elapsed);
}

/** Pure: nowy stan po UDANYM zapytaniu (reset backoffu). */
export function afterSuccess(now: number): RateState {
  return { lastAt: now, failures: 0 };
}

/** Pure: nowy stan po BŁĘDZIE (rośnie backoff, ograniczony). */
export function afterFailure(state: RateState, now: number): RateState {
  return { lastAt: now, failures: Math.min(state.failures + 1, 10) };
}

/** Uczciwy komunikat o niedostępności źródła (bez udawania, że działa). */
export function unavailableMessage(source: string): string {
  return `Źródło „${source}" chwilowo niedostępne — spróbuję później (backoff). Nie zmyślam wyników.`;
}
