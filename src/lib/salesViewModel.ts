// === Model widoku sprzedaży (salesViewModel) — czysty, testowalny ===
// Pulpit ma domyślnie pokazywać „Do działania" (bez odrzuconych), a GŁÓWNA akcja kontaktowa ma
// wynikać z DANYCH leada: jest telefon → Zadzwoń, jest tylko e-mail → Napisz, brak → Znajdź kontakt.
// Komponuje istniejące crmBuckets (nie duplikuje klasyfikacji). Zachowuje stare statusy i API. S9-safe.

import type { Lead } from "../types";
import { cleanPhone } from "./contactActions";
import { leadsInBucket, type CrmBucket } from "./crmBuckets";

export type PrimaryActionKind = "call" | "email" | "find";
export interface PrimaryAction { kind: PrimaryActionKind; label: string; value: string }

/** Domyślny widok pulpitu: „Do działania" (nie „Wszyscy") — odrzuceni są w Archiwum. */
export const DEFAULT_SALES_BUCKET: CrmBucket = "actionable";

/** Pure: e-mail leada — najpierw pole email (z @), w razie braku contact (z @). */
export function leadEmailAddr(lead: Pick<Lead, "email" | "contact">): string {
  const e = (lead.email || "").trim();
  if (e.includes("@")) return e;
  const c = (lead.contact || "").trim();
  return c.includes("@") ? c : "";
}

/** Pure: telefon leada — pole contact, gdy nie jest e-mailem (oczyszczony do cyfr/+). */
export function leadPhone(lead: Pick<Lead, "contact">): string {
  const c = (lead.contact || "").trim();
  return c && !c.includes("@") ? cleanPhone(c) : "";
}

/** Pure: GŁÓWNA akcja kontaktowa zależna od danych. Telefon > e-mail > znajdź kontakt. */
export function primaryContactAction(lead: Pick<Lead, "email" | "contact" | "company">): PrimaryAction {
  const phone = leadPhone(lead);
  if (phone) return { kind: "call", label: "📞 Zadzwoń", value: phone };
  const email = leadEmailAddr(lead);
  if (email) return { kind: "email", label: "✉ Napisz", value: email };
  return { kind: "find", label: "🔎 Znajdź kontakt", value: lead.company };
}

export interface SalesRow { lead: Lead; primary: PrimaryAction }

/** Pure: wiersze pulpitu dla danego kubełka, z wyliczoną główną akcją. Domyślnie bez odrzuconych. */
export function buildSalesRows(leads: Lead[], bucket: CrmBucket = DEFAULT_SALES_BUCKET): SalesRow[] {
  return leadsInBucket(leads, bucket).map((lead) => ({ lead, primary: primaryContactAction(lead) }));
}
