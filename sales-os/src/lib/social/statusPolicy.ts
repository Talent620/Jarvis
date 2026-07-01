// === Uczciwe statusy publikacji social + zgodność S9 (statusPolicy) ===
// CZYSTY moduł bez zależności (Prisma/Next) — dzięki temu można go testować z głównego projektu.
// Rozdziela stany: DRAFT / APPROVED / SCHEDULED / PUBLISHING / PUBLISHED_CONFIRMED / SIMULATED /
// FAILED. NIE istnieje ścieżka, w której SYMULACJA wygląda jak realna publikacja: brak tokena →
// SIMULATED (nigdy PUBLISHED), a licznik opublikowanych liczy WYŁĄCZNIE potwierdzone. S9-safe:
// zero regex z /u i \p{L} — hashtagi wyłuskujemy jawnymi klasami znaków (w tym polskimi).

export type PublishStatus =
  | "DRAFT"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED_CONFIRMED"
  | "SIMULATED"
  | "FAILED";

// S9/Chrome 79: NIE używamy /u ani \p{L}. Jawne klasy: łacina + cyfry + _ + polskie litery.
const HASHTAG_RE = /#[A-Za-z0-9_ĄĆĘŁŃÓŚŹŻąćęłńóśźż]+/g;

/** Pure: wyłuskaj hashtagi (unikatowe, do `max`). Obsługuje polskie znaki bez /u i \p{L}. */
export function extractHashtags(text: string, max = 8): string[] {
  const found = (text || "").match(HASHTAG_RE) || [];
  return Array.from(new Set(found)).slice(0, max);
}

export interface PublishAttempt {
  /** Czy jest REALNY token API (inaczej to tylko symulacja). */
  hasToken: boolean;
  /** Id zwrócone przez API — DOWÓD publikacji. */
  externalId?: string | null;
  error?: string | null;
  scheduled?: boolean;
}

/**
 * Pure: wyprowadź uczciwy status publikacji. Brak tokena → SIMULATED (NIGDY PUBLISHED). Błąd →
 * FAILED. Potwierdzony externalId → PUBLISHED_CONFIRMED. Zaplanowane → SCHEDULED. Inaczej PUBLISHING
 * (rozpoczęto, brak potwierdzenia). Nie ma drogi, w której symulacja staje się publikacją.
 */
export function derivePublishStatus(a: PublishAttempt): PublishStatus {
  if (!a.hasToken) return "SIMULATED";
  if (a.error) return "FAILED";
  if (a.externalId) return "PUBLISHED_CONFIRMED";
  if (a.scheduled) return "SCHEDULED";
  return "PUBLISHING";
}

export function isSimulated(status: string): boolean {
  return status === "SIMULATED";
}

/** Potwierdzona publikacja (z kompatybilnością starego „PUBLISHED"). */
export function isPublishedLike(status: string): boolean {
  return status === "PUBLISHED_CONFIRMED" || status === "PUBLISHED";
}

/** Pure: licznik opublikowanych — symulacje NIE są liczone. Zgodny ze starymi rekordami. */
export function countPublished(records: { status: string }[]): number {
  return (records || []).filter((r) => isPublishedLike(r.status)).length;
}

/** Toast dla symulacji — jednoznaczny, nie udaje sukcesu. */
export const SIMULATION_TOAST = "Symulacja zakończona — nic nie opublikowano";
