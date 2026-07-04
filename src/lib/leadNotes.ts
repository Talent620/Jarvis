// === Dziennik kontaktu leada (CRM) — notatki po rozmowach ===
// CZYSTE helpery na tablicach (testowalne). Migracja: stare pojedyncze `note` pokazujemy jako
// pierwszy wpis w osi czasu, NIC nie usuwając (wstecznie zgodne). Najnowsze wpisy na górze.

import type { Lead, LeadNote } from "../types";

/** Pure: złóż pełną oś czasu notatek — łączy migrację starego `note` z listą `notes`. Najnowsze pierwsze. */
export function leadTimeline(lead: Pick<Lead, "note" | "notes" | "createdAt">): LeadNote[] {
  const out: LeadNote[] = [...(lead.notes || [])];
  // Stary pojedynczy `note` (jeśli nie został już przeniesiony do notes) — dołóż jako najstarszy wpis.
  const legacy = (lead.note || "").trim();
  if (legacy && !out.some((n) => n.text === legacy)) {
    out.push({ at: (lead as { createdAt?: number }).createdAt || 0, text: legacy });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Pure: dopisz notatkę do listy (najnowsza pierwsza). Pusty tekst → bez zmian. */
export function appendLeadNote(notes: LeadNote[] | undefined, text: string, now: number): LeadNote[] {
  const t = (text || "").trim();
  const list = notes ? notes.slice() : [];
  if (!t) return list;
  list.unshift({ at: now, text: t.slice(0, 2000) });
  return list.slice(0, 100); // rozsądny limit na lead
}
