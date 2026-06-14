import { store } from "./store";
import { gmailSend } from "./google";
import { draftOffer } from "./offer";
import { splitOffer } from "./glinks";
import type { Lead } from "../types";

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

/** Sprawdź połączenie z pocztą (Windows): łączy się i loguje hasłem aplikacji, bez wysyłki. */
export async function verifyMailConnection(): Promise<{ ok: boolean; message: string }> {
  const s = store.settings;
  const bridge = (window as any).jarvisDesktop;
  if (!bridge?.verifyMail) {
    return { ok: false, message: "Sprawdzanie działa w aplikacji na Windows. Na telefonie: ⚙ → Synchronizacja → Połącz konto Google → Sprawdź Gmaila." };
  }
  if (!s.smtpUser?.trim() || !s.smtpPass?.trim()) {
    return { ok: false, message: "Najpierw wpisz adres e-mail i hasło aplikacji." };
  }
  const r = await bridge.verifyMail({
    host: s.smtpHost?.trim() || "smtp.gmail.com",
    port: Number(s.smtpPort) || 465,
    user: s.smtpUser.trim(),
    pass: s.smtpPass,
  });
  if (r === "ok") return { ok: true, message: `✅ Poczta połączona poprawnie (${s.smtpUser.trim()}) — można wysyłać.` };
  const msg = typeof r === "string" ? r.replace(/^err:/, "") : "Nie udało się połączyć — sprawdź dane poczty.";
  return { ok: false, message: msg };
}

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

/** Zapisz wysłany mail w Skrzynce wysłanych (potwierdzona wysyłka wprost z aplikacji). */
export function recordSent(entry: { to: string; subject: string; via: "SMTP" | "Gmail"; company?: string }) {
  store.setData((d) => {
    if (!d.sentMail) d.sentMail = [];
    d.sentMail.unshift({ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: Date.now() });
    if (d.sentMail.length > 500) d.sentMail.length = 500;
  });
}

/**
 * Wyślij ofertę najlepszym dostępnym kanałem (bez otwierania innej aplikacji):
 * desktop → SMTP; telefon/inne → Gmail przez backend OAuth. Gdy żaden nie jest
 * skonfigurowany, zwraca błąd (UI proponuje wtedy zwykły Gmail compose).
 * Po udanej wysyłce zapisuje wpis w Skrzynce wysłanych.
 */
export async function sendOfferEmail(to: string, subject: string, body: string, company?: string): Promise<SendResult> {
  if (canSendMail()) {
    const err = await sendMailNow(to, subject, body);
    if (err) return { ok: false, error: err };
    recordSent({ to: to.trim(), subject, via: "SMTP", company });
    return { ok: true, via: "SMTP" };
  }
  if (hasBackendGmail()) {
    const r = await gmailSend(to.trim(), subject, body);
    if (!/^Wysłano/i.test(r)) return { ok: false, error: r };
    recordSent({ to: to.trim(), subject, via: "Gmail", company });
    return { ok: true, via: "Gmail" };
  }
  return { ok: false, error: "Brak skonfigurowanej wysyłki — użyj przycisku Gmail (otworzy gotową wiadomość)." };
}

export type DraftSendResult = SendResult & { offer?: string };

/**
 * „Napisz i wyślij" jednym kliknięciem: jeśli oferta nie istnieje, JARVIS ją pisze,
 * dopisuje podpis i wysyła najlepszym kanałem (SMTP/Gmail). Nowy szkic zwraca w `offer`
 * (do zapisania w leadzie). Temat/treść liczone są tak samo jak przy zwykłej wysyłce.
 */
export async function draftAndSendOffer(lead: Lead, email: string): Promise<DraftSendResult> {
  let text = (lead.offer || "").trim();
  if (!text) {
    text = (await draftOffer(lead)).trim();
  }
  if (!text) return { ok: false, error: "Nie udało się napisać oferty — sprawdź klucz API (⚙ → Mózg)." };
  const { subject, body } = splitOffer(text, `Oferta dla ${lead.company}`, store.settings.emailSignature);
  const r = await sendOfferEmail(email, subject, body, lead.company);
  return { ...r, offer: text };
}
