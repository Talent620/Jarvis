// Usuwanie leada z możliwością cofnięcia (siatka „usuń + Cofnij").
// Czyste, testowalne funkcje: komponent tylko wpina toast z akcją „Cofnij".
import type { Lead } from "../types";

export interface RemoveResult {
  /** Lista po usunięciu. */
  next: Lead[];
  /** Usunięty lead (null gdy nie znaleziono). */
  removed: Lead | null;
  /** Pozycja, z której usunięto — do przywrócenia w to samo miejsce. */
  index: number;
}

/** Pure: usuń lead po id, zwracając nową listę + usunięty rekord i jego pozycję. */
export function removeLead(leads: Lead[], id: string): RemoveResult {
  const index = leads.findIndex((l) => l.id === id);
  if (index < 0) return { next: leads.slice(), removed: null, index: -1 };
  const removed = leads[index];
  const next = leads.slice(0, index).concat(leads.slice(index + 1));
  return { next, removed, index };
}

/** Pure: przywróć usunięty lead w oryginalne miejsce (idempotentnie — nie duplikuje). */
export function restoreLead(leads: Lead[], removed: Lead | null, index: number): Lead[] {
  if (!removed) return leads.slice();
  if (leads.some((l) => l.id === removed.id)) return leads.slice(); // już obecny — nie duplikuj
  const at = Math.max(0, Math.min(index, leads.length));
  return leads.slice(0, at).concat([removed], leads.slice(at));
}
