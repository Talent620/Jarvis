import { store } from "./store";
import { gmailSend } from "./google";
import { draftOffer } from "./offer";
import { splitOffer } from "./glinks";
import { fetchTimeout } from "./http";
import type { Lead } from "../types";

// Wysyłka e-maili WPROST z aplikacji — inteligentny wybór kanału:
//  1) DESKTOP (Windows): SMTP przez proces Electrona (sekcja ⚙ → Poczta).
//  2) TELEFON + backend: przekaźnik SMTP (/v1/smtp/send) — wysyła „w tle" hasłem
//     aplikacji, BEZ Google OAuth i BEZ otwierania Gmaila. Wymaga tylko ⚙ → Synchronizacja.
//  3) TELEFON + Gmail OAuth: natywna wysyłka Gmailem (gdy połączono konto Google).
//  4) Brak wszystkiego: sygnał „otwórz Gmail compose" (zawsze działa, jedno tapnięcie).

export const canSendMail = (): boolean => {
  const s = store.settings;
  return typeof window !== "undefined" && !!(window as any).jarvisDesktop?.sendMail && !!s.smtpUser?.trim() && !!s.smtpPass?.trim();
};

export const mailConfigured = (): boolean => !!store.settings.smtpUser?.trim() && !!store.settings.smtpPass?.trim();

/** Czy backend (Worker) jest skonfigurowany — adres + token synchronizacji. */
export const hasBackend = (): boolean => !!store.settings.syncUrl?.trim() && !!store.settings.syncToken?.trim();

/** Czy backend Gmail (OAuth) jest skonfigurowany — działa też na telefonie. */
export const hasBackendGmail = (): boolean => hasBackend();

/**
 * Czy możemy użyć przekaźnika SMTP przez backend (telefon „pyk i samo", bez Google OAuth):
 * mamy backend (Worker) + adres i hasło aplikacji, a NIE jesteśmy na desktopie (tam SMTP idzie wprost).
 */
export const canRelaySmtp = (): boolean => hasBackend() && mailConfigured() && !((window as any)?.jarvisDesktop?.sendMail);

/** Czy w ogóle możemy wysłać mail bezpośrednio (desktop SMTP, przekaźnik SMTP albo Gmail). */
export const canSendDirect = (): boolean => canSendMail() || canRelaySmtp() || hasBackendGmail();

/** Niskopoziomowe wywołanie backendu (Bearer = token synchronizacji). */
async function relayCall(path: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  const s = store.settings;
  const base = s.syncUrl!.trim().replace(/\/$/, "");
  try {
    // Przekaźnik SMTP po stronie serwera łączy się z pocztą — dajemy zapas czasu (20 s).
    const res = await fetchTimeout(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${s.syncToken!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, 20000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error || `Błąd (${res.status}).` };
    return { ok: true };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, error: aborted ? "Przekroczono czas wysyłki przez backend." : `Błąd połączenia z backendem: ${e instanceof Error ? e.message : e}` };
  }
}

/** Wyślij e-mail przez przekaźnik SMTP w backendzie (telefon). */
async function relaySend(to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const s = store.settings;
  return relayCall("/v1/smtp/send", {
    host: s.smtpHost?.trim() || "smtp.gmail.com",
    port: Number(s.smtpPort) || 465,
    user: s.smtpUser.trim(),
    pass: s.smtpPass,
    to: to.trim(),
    subject,
    body,
  });
}

/** Sprawdź połączenie z pocztą (Windows): łączy się i loguje hasłem aplikacji, bez wysyłki. */
export async function verifyMailConnection(): Promise<{ ok: boolean; message: string }> {
  const s = store.settings;
  const bridge = (window as any).jarvisDesktop;
  // Windows: sprawdzenie wprost przez most Electrona.
  if (bridge?.verifyMail) {
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
  // Telefon: sprawdzenie przez przekaźnik SMTP w backendzie (hasło aplikacji).
  if (hasBackend()) {
    if (!s.smtpUser?.trim() || !s.smtpPass?.trim()) {
      return { ok: false, message: "Najpierw wpisz adres e-mail i hasło aplikacji (⚙ → Poczta)." };
    }
    const r = await relayCall("/v1/smtp/verify", {
      host: s.smtpHost?.trim() || "smtp.gmail.com",
      port: Number(s.smtpPort) || 465,
      user: s.smtpUser.trim(),
      pass: s.smtpPass,
    });
    return r.ok
      ? { ok: true, message: `✅ Poczta połączona poprawnie (${s.smtpUser.trim()}) — telefon wysyła w tle.` }
      : { ok: false, message: r.error || "Nie udało się połączyć — sprawdź dane poczty i backend." };
  }
  return { ok: false, message: "Aby wysyłać bez Gmaila: na Windows wpisz adres + hasło aplikacji; na telefonie dodaj backend w ⚙ → Synchronizacja." };
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

/** Eksport Skrzynki wysłanych do CSV (Excel/Arkusze) — rejestr „kogo i kiedy". */
export function sentMailToCsv(sent: { at: number; company?: string; to: string; subject: string; via: string }[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Data", "Firma", "Adres", "Temat", "Kanal"];
  const rows = (sent || []).map((m) =>
    [new Date(m.at).toLocaleString("pl-PL"), m.company || "", m.to, m.subject, m.via].map(esc).join(","),
  );
  return [head.join(","), ...rows].join("\r\n");
}

/** Czy znacznik czasu przypada na ten sam dzień kalendarzowy co `now`. */
export function isSameDay(at: number, now = Date.now()): boolean {
  const a = new Date(at), b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Ile maili wysłano dzisiaj (do licznika w Skrzynce wysłanych). */
export function sentTodayCount(sent: { at: number }[], now = Date.now()): number {
  return (sent || []).filter((m) => isSameDay(m.at, now)).length;
}

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
export async function sendOfferEmail(to: string, subject: string, body: string, company?: string, record = true): Promise<SendResult> {
  if (canSendMail()) {
    const err = await sendMailNow(to, subject, body);
    if (err) return { ok: false, error: err };
    if (record) recordSent({ to: to.trim(), subject, via: "SMTP", company });
    return { ok: true, via: "SMTP" };
  }
  if (canRelaySmtp()) {
    const r = await relaySend(to, subject, body);
    if (!r.ok) return { ok: false, error: r.error || "Nie udało się wysłać przez backend." };
    if (record) recordSent({ to: to.trim(), subject, via: "SMTP", company });
    return { ok: true, via: "SMTP" };
  }
  if (hasBackendGmail()) {
    const r = await gmailSend(to.trim(), subject, body);
    if (!/^Wysłano/i.test(r)) return { ok: false, error: r };
    if (record) recordSent({ to: to.trim(), subject, via: "Gmail", company });
    return { ok: true, via: "Gmail" };
  }
  return { ok: false, error: "Brak skonfigurowanej wysyłki — użyj przycisku Gmail (otworzy gotową wiadomość)." };
}

/**
 * Wyślij testowy e-mail na własny adres — potwierdza, że cała wysyłka działa
 * end-to-end (nie tylko logowanie). Nie zapisuje wpisu w Skrzynce wysłanych.
 */
export async function sendTestEmail(): Promise<{ ok: boolean; message: string }> {
  const s = store.settings;
  const to = s.smtpUser?.trim();
  if (!to) return { ok: false, message: "Najpierw wpisz swój adres e-mail (⚙ → Poczta)." };
  if (!canSendDirect()) {
    return { ok: false, message: "Brak gotowej wysyłki — na Windows wpisz hasło aplikacji; na telefonie dodaj backend (⚙ → Synchronizacja)." };
  }
  const r = await sendOfferEmail(
    to,
    "JARVIS — test poczty ✅",
    "To jest wiadomość testowa wysłana z JARVIS-a.\n\nJeśli ją widzisz, wysyłka e-mail działa poprawnie. Możesz spokojnie wysyłać oferty jednym kliknięciem.",
    undefined,
    false,
  );
  return r.ok
    ? { ok: true, message: `✅ Wysłano testowy e-mail na ${to} (${r.via}). Sprawdź swoją skrzynkę.` }
    : { ok: false, message: r.error };
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
