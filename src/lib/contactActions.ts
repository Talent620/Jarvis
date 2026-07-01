// === Akcje kontaktu z kandydatem (contactActions) — czyste, testowalne ===
// UI-utility (NIE silnik): normalizacja telefonu, budowa tel:, klasyfikacja i filtr kontaktu.
// Klik kontaktu ZAWSZE ma wykonać widoczną akcję — logika decyzji jest tu, prezentacja w komponencie.
// S9-safe (bez /u, \p, lookbehind).

export type ContactFilter = "all" | "phone" | "email" | "none";

/** Pure: zostaw cyfry i wiodący plus (usuń spacje/myślniki/nawiasy). */
export function cleanPhone(raw?: string): string {
  return (raw || "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}

/** Pure: adres tel: dla dialera (pusty gdy brak cyfr). */
export function telHref(raw?: string): string {
  const p = cleanPhone(raw);
  return p ? `tel:${p}` : "";
}

/** Pure: czy kandydat ma użyteczny telefon. */
export function hasPhone(c: { phone?: string }): boolean {
  return !!cleanPhone(c.phone);
}

/** Pure: czy kandydat ma poprawny e-mail. */
export function hasEmail(c: { email?: string }): boolean {
  return !!(c.email && c.email.includes("@"));
}

/** Pure: czy kandydat ma jakikolwiek kontakt. */
export function hasAnyContact(c: { phone?: string; email?: string }): boolean {
  return hasPhone(c) || hasEmail(c);
}

/** Pure: dopasowanie kandydata do filtra kontaktu (all/phone/email/none). */
export function matchContactFilter(c: { phone?: string; email?: string }, filter: ContactFilter): boolean {
  switch (filter) {
    case "phone": return hasPhone(c);
    case "email": return hasEmail(c);
    case "none": return !hasAnyContact(c);
    default: return true;
  }
}
