import { store } from "./store";

// === Status Deck — system raportuje, co wymaga Twojej decyzji ===
// Premium asystent nie czeka biernie — sam pokazuje flagi: nieudane wykonania
// (FAILED EXEC) i decyzje do podjęcia (DECISIONS DUE). Czyste funkcje liczące
// flagi z bieżącego stanu — łatwe do testów i odświeżania.

export interface StatusFlag {
  id: "failed" | "decisions" | "review";
  label: string;
  count: number;
  severity: "error" | "warn" | "info";
  detail: string;
}

const DAY = 86_400_000;

/** Ile akcji narzędzi nie powiodło się w ostatniej dobie (FAILED EXEC). */
export function failedExecCount(now = Date.now()): number {
  return (store.data.audit || []).filter((a) => a.status === "error" && now - a.at < DAY).length;
}

/** Pozycje wymagające decyzji użytkownika (nowe leady, gotowe oferty, zaległe przypomnienia). */
export function decisionItems(now = Date.now()): { newLeads: number; offersToSend: number; overdueReminders: number; total: number } {
  const leads = store.data.leads || [];
  const newLeads = leads.filter((l) => l.status === "new").length;
  const offersToSend = leads.filter((l) => !!l.offer && l.status === "offer").length;
  const overdueReminders = (store.data.reminders || []).filter((r) => !r.fired && new Date(r.at).getTime() <= now).length;
  return { newLeads, offersToSend, overdueReminders, total: newLeads + offersToSend + overdueReminders };
}

/** Ile fiszek czeka na powtórkę (lekka flaga „do przejrzenia"). */
export function dueReviewCount(now = Date.now()): number {
  return (store.data.flashcards || []).filter((c) => c.due <= now).length;
}

/** Pełny zestaw flag statusu (posortowany wg wagi). Puste, gdy wszystko spokojne. */
export function statusFlags(now = Date.now()): StatusFlag[] {
  const flags: StatusFlag[] = [];
  const failed = failedExecCount(now);
  if (failed > 0) {
    flags.push({ id: "failed", label: `${failed} FAILED EXEC`, count: failed, severity: "error", detail: "Akcje narzędzi, które się nie powiodły w ostatniej dobie. Sprawdź w ⋯ → Dane → audyt." });
  }
  const d = decisionItems(now);
  if (d.total > 0) {
    const bits: string[] = [];
    if (d.newLeads) bits.push(`${d.newLeads} nowych leadów do kontaktu`);
    if (d.offersToSend) bits.push(`${d.offersToSend} gotowych ofert do wysłania`);
    if (d.overdueReminders) bits.push(`${d.overdueReminders} zaległych przypomnień`);
    flags.push({ id: "decisions", label: `${d.total} DECISIONS DUE`, count: d.total, severity: "warn", detail: bits.join(" · ") });
  }
  const due = dueReviewCount(now);
  if (due > 0) {
    flags.push({ id: "review", label: `${due} DO POWTÓRKI`, count: due, severity: "info", detail: "Fiszki gotowe do powtórki (Kapsuły Wiedzy)." });
  }
  return flags;
}
