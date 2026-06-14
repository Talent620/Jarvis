import { store } from "./store";
import { gmailSend } from "./google";

// Wysyłka e-maili WPROST z aplikacji — inteligentny wybór kanału:
//  1) DESKTOP (Windows): SMTP przez proces Electrona (sekcja ⚙ → Poczta).
//  2) TELEFON / dowolna platforma: Gmail przez backend OAuth (⚙ → Synchronizacja
//     + Połącz konto Google) — wysyła NATYWNIE, bez otwierania aplikacji Gmail.
//  3) Brak obu: sygnał „otwórz Gmail compose" (zawsze działa, jedno tapnięcie).

export const canSendMail = (): boolean => {
  const s = store.settings;
  return typeof window !== "undefined" && !!(window as any).jarvisDesktop?.sendMail && !!s.smtpUser?.trim() && !!s.smtpPass?.trim();
};

export const mailConfigured = (): boolean => !!store.settings.smtpUser?.trim() && !!store.settings.smtpPass?.trim();

/** Czy backend Gmail (OAuth) jest skonfigurowany — działa też na telefonie. */
export const hasBackendGmail = (): boolean => !!store.settings.syncUrl?.trim() && !!store.settings.syncToken?.trim();

/** Czy w ogóle możemy wysłać mail bezpośrednio (SMTP albo backend Gmail). */
export const canSendDirect = (): boolean => canSendMail() || hasBackendGmail();

/** Wyślij e-mail teraz przez SMTP (desktop). Zwraca null = sukces albo treść błędu. */
export async function sendMailNow(to: string, subject: string, body: string): Promise<string | null> {
  const s = store.settings;
  const bridge = (window as any).jarvisDesktop;
  if (!bridge?.sendMail) return "Wysyłka SMTP działa w aplikacji na Windows — na telefonie użyj Gmaila przez backend.";
  if (!s.smtpUser?.trim() || !s.smtpPass?.trim()) return "Skonfiguruj pocztę w ⚙ → Poczta (adres + hasło aplikacji).";
  const r = await bridge.sendMail({
    host: s.smtpHost?.trim() || "smtp.gmail.com",
    port: Number(s.smtpPort) || 465,
    user: s.smtpUser.trim(),
    pass: s.smtpPass,
    to: to.trim(),
    subject,
    body,
  });
  // Most może zwrócić cokolwiek — twardo sprowadź do czytelnego komunikatu
  // (koniec „[object Object]", gdy zwróci obiekt/undefined).
  if (r === "ok") return null;
  return typeof r === "string" ? r.replace(/^err:/, "") : "Błąd mostka SMTP — sprawdź dane poczty w ⚙ → Poczta.";
}

export type SendResult = { ok: true; via: "SMTP" | "Gmail" } | { ok: false; error: string };

/**
 * Wyślij ofertę najlepszym dostępnym kanałem (bez otwierania innej aplikacji):
 * desktop → SMTP; telefon/inne → Gmail przez backend OAuth. Gdy żaden nie jest
 * skonfigurowany, zwraca błąd (UI proponuje wtedy zwykły Gmail compose).
 */
export async function sendOfferEmail(to: string, subject: string, body: string): Promise<SendResult> {
  if (canSendMail()) {
    const err = await sendMailNow(to, subject, body);
    return err ? { ok: false, error: err } : { ok: true, via: "SMTP" };
  }
  if (hasBackendGmail()) {
    const r = await gmailSend(to.trim(), subject, body);
    return /^Wysłano/i.test(r) ? { ok: true, via: "Gmail" } : { ok: false, error: r };
  }
  return { ok: false, error: "Brak skonfigurowanej wysyłki — użyj przycisku Gmail (otworzy gotową wiadomość)." };
}
