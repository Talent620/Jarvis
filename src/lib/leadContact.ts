// === Prawda o kontakcie z leadem (czyste, testowalne) ===
// Otwarcie zewnętrznego kompozytora (Gmail/mailto/SMS) NIE jest dowodem kontaktu — użytkownik
// może nigdy nie wysłać. Lead oznaczamy jako skontaktowany dopiero po POTWIERDZONEJ wysyłce
// (SMTP/Gmail backend) albo po JAWNYM potwierdzeniu użytkownika ("wysłałem/był kontakt").

import type { LeadStatus } from "../types";
import { isValidEmail } from "./mailer";

// Re-eksport wspólnego walidatora e-maila — jedno źródło prawdy dla CRM i poczty.
export { isValidEmail };

/**
 * Status po potwierdzonym kontakcie: świeży/kontakt → oferta (ruszył proces),
 * w pozostałych przypadkach bez zmian (nie cofamy won/lost/offer).
 */
export function nextStatusAfterContact(current: LeadStatus): LeadStatus {
  return current === "new" || current === "contacted" ? "offer" : current;
}

/** Czy otwarcie tego kanału samo w sobie potwierdza kontakt? Zewnętrzne kompozytory — NIE. */
export function autoConfirmsContact(channel: "smtp" | "salesos" | "gmail" | "mailto" | "sms"): boolean {
  // Tylko kanały z potwierdzeniem dostarczenia po stronie systemu.
  return channel === "smtp" || channel === "salesos";
}
