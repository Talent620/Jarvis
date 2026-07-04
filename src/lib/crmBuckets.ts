// === Kubełki CRM (crmBuckets) — czysta klasyfikacja leadów do zakładek ===
// Jeden ekran „Sprzedaż / CRM" z zakładkami. Klasyfikacja jest deterministyczna i współdzielona przez
// UI (zakładki) i testy (E2E realnego przepływu). „Do działania" to domyślny widok — NIE pokazuje
// odrzuconych (lost). Odrzuceni trafiają do „Archiwum". Zgodne ze starymi statusami lead. S9-safe.

import type { Lead, LeadStatus } from "../types";

export type CrmBucket = "actionable" | "clients" | "archive";

/** Pure: do którego kubełka trafia lead. won → Klienci; lost → Archiwum; reszta → Do działania. */
export function leadBucket(lead: Pick<Lead, "status">): CrmBucket {
  const s: LeadStatus = lead.status;
  if (s === "won") return "clients";
  if (s === "lost") return "archive";
  return "actionable"; // new / contacted / offer
}

/** Pure: policz leady w każdym kubełku (do plakietek na zakładkach). */
export function bucketCounts(leads: Lead[]): Record<CrmBucket, number> {
  const out: Record<CrmBucket, number> = { actionable: 0, clients: 0, archive: 0 };
  for (const l of leads || []) out[leadBucket(l)] += 1;
  return out;
}

/** Pure: leady danego kubełka (zachowuje kolejność wejściową). */
export function leadsInBucket(leads: Lead[], bucket: CrmBucket): Lead[] {
  return (leads || []).filter((l) => leadBucket(l) === bucket);
}
