// === Kieszonkowa Ciągłość: oferta wznowienia trwałego celu po restarcie ===
// Ożywia resumableGoalsNewestFirst (dotąd BEZ konsumenta — wznowienie było tylko ręczne
// w panelu). Zgodnie z żelazną regułą repo outbound NIGDY nie wznawia się sam po cichu:
// to jest proaktywna OFERTA („wznowić?"), a wykonanie i tak przechodzi przez bramkę zgód.
// Cele żyją w IndexedDB (async), a silnik proaktywny jest synchroniczny — stąd mały,
// odświeżany w cyklu aplikacji CACHE (wzorzec jak predictionCycle). S9-safe.

import { resumableGoalsNewestFirst } from "./goalRuntime";
import type { GoalRecord, GoalStorage } from "./goalState";

/** Nie nękaj o cele starsze niż tydzień — po tylu dniach oferta to spam, nie pomoc. */
export const RESUME_MAX_AGE_MS = 7 * 86_400_000;

let cache: GoalRecord[] = [];

/** Pure: które z celów nadają się do OFERTY wznowienia (świeże, niedokończone). */
export function offerableGoals(goals: GoalRecord[], now: number): GoalRecord[] {
  return goals.filter((g) => now - (g.updatedAt || g.createdAt || 0) <= RESUME_MAX_AGE_MS);
}

/** Odśwież cache z trwałego magazynu (wołane w cyklu aplikacji; błędy nie wybuchają). */
export async function refreshResumableGoals(now = Date.now(), storage?: GoalStorage): Promise<GoalRecord[]> {
  try {
    cache = offerableGoals(await resumableGoalsNewestFirst(storage), now);
  } catch {
    /* magazyn niedostępny — zostaje poprzedni cache; oferta to udogodnienie */
  }
  return cache;
}

/** Synchronny odczyt dla silnika proaktywnego. */
export function cachedResumableGoals(): GoalRecord[] {
  return cache;
}

/** Reset (testy). */
export function resetGoalResumeCache(): void {
  cache = [];
}

/**
 * Pure: tekst oferty wznowienia dla NAJNOWSZEGO wznawialnego celu (albo null).
 * Mówi prawdę o stanie (kroki potwierdzone / czeka na zgodę) i uspokaja o idempotencji —
 * wznowienie NIE wykona niczego podwójnie (seed + dedup correlationId w goalRuntime).
 */
export function resumeNudgeText(goals: GoalRecord[], now: number): string | null {
  const fresh = offerableGoals(goals, now);
  if (!fresh.length) return null;
  const g = fresh[0];
  const steps = g.plan.steps || [];
  const done = steps.filter((s) => g.results[s.id]?.state === "CONFIRMED").length;
  const stan =
    g.status === "waiting_consent"
      ? "czeka na Twoją zgodę"
      : g.status === "waiting_user"
        ? "czeka na Twoje sprawdzenie"
        : g.status === "paused"
          ? "wstrzymany"
          : "niedokończony";
  return `🔁 Cel „${g.goal}” jest ${stan} (${done}/${steps.length} kroków potwierdzonych). Wznowić? Nic nie wykona się podwójnie.`;
}
