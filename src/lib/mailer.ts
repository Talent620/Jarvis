import { store } from "./store";
import { gmailSend } from "./google";
import { draftOffer } from "./offer";
import { splitOffer } from "./glinks";
import { fetchTimeout } from "./http";
import { evaluateContactPolicy } from "./leadSourcePolicy";
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

/** Czy desktop ma natywną wysyłkę Gmail (ten sam token co kalendarz, bez serwera). */
export const canSendGmailNative = (): boolean =>
  typeof window !== "undefined" && !!(window as any).jarvisDesktop?.gmailSend;

/**
 * Czy możemy użyć przekaźnika SMTP przez backend (telefon „pyk i samo", bez Google OAuth):
 * mamy backend (Worker) + adres i hasło aplikacji, a NIE jesteśmy na desktopie (tam SMTP idzie wprost).
 */
export const canRelaySmtp = (): boolean => hasBackend() && mailConfigured() && !((window as any)?.jarvisDesktop?.sendMail);

/** Czy w ogóle możemy wysłać mail bezpośrednio (desktop SMTP/Gmail, przekaźnik SMTP albo backend Gmail). */
export const canSendDirect = (): boolean => canSendMail() || canRelaySmtp() || hasBackendGmail() || canSendGmailNative();

// --- Diagnostyka gotowości wysyłki (jeden, czytelny powód „dlaczego nie idzie") ---

export type MailChannel = "SMTP-desktop" | "SMTP-relay" | "Gmail-backend" | "none";

export interface MailReadiness {
  ready: boolean;
  channel: MailChannel;
  reason: string;
}

export interface MailFlags {
  desktopSmtp: boolean; // canSendMail()
  relay: boolean; // canRelaySmtp()
  backendGmail: boolean; // hasBackendGmail()
  isDesktop: boolean; // most Electrona obecny
  mailCreds: boolean; // adres + hasło aplikacji
  backend: boolean; // syncUrl + syncToken
}

/** Czysta logika: z flag → gotowość + JEDEN powód/instrukcja. Łatwa do testów. */
export function explainMailReadiness(f: MailFlags): MailReadiness {
  if (f.desktopSmtp) return { ready: true, channel: "SMTP-desktop", reason: "Gotowe — wysyłka SMTP (komputer)." };
  if (f.relay) return { ready: true, channel: "SMTP-relay", reason: "Gotowe — wysyłka w tle przez backend (SMTP)." };
  if (f.backendGmail) return { ready: true, channel: "Gmail-backend", reason: "Gotowe — wysyłka przez Gmail (backend)." };

  if (f.isDesktop) {
    return { ready: false, channel: "none", reason: "Wpisz adres e-mail i hasło aplikacji w ⚙ → Poczta (hasło aplikacji, nie zwykłe)." };
  }
  // Telefon/PWA:
  if (!f.backend) return { ready: false, channel: "none", reason: "Dodaj backend w ⚙ → Synchronizacja (adres + token), potem dane poczty — telefon wyśle w tle." };
  if (!f.mailCreds) return { ready: false, channel: "none", reason: "Masz backend — dodaj jeszcze adres + hasło aplikacji w ⚙ → Poczta (albo połącz Gmaila w ⚙ → Integracje)." };
  return { ready: false, channel: "none", reason: "Brak gotowej wysyłki — sprawdź dane poczty (⚙ → Poczta) lub połącz Gmaila (⚙ → Integracje)." };
}

/** Gotowość wysyłki maili „tu i teraz" — z czytelnym powodem (do UI/diagnostyki). */
export function mailReadiness(): MailReadiness {
  return explainMailReadiness({
    desktopSmtp: canSendMail(),
    relay: canRelaySmtp(),
    backendGmail: hasBackendGmail(),
    isDesktop: typeof window !== "undefined" && !!(window as any).jarvisDesktop?.sendMail,
    mailCreds: mailConfigured(),
    backend: hasBackend(),
  });
}

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
    pass: s.smtpPass.trim(),
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
      pass: s.smtpPass.trim(),
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
      pass: s.smtpPass.trim(),
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
    pass: s.smtpPass.trim(),
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
/** Prosta, praktyczna walidacja adresu e-mail (coś@coś.tld, bez spacji). */
export const isValidEmail = (s: string): boolean => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test((s || "").trim());

export async function sendOfferEmail(to: string, subject: string, body: string, company?: string, record = true): Promise<SendResult> {
  // Waliduj adres ZANIM wyślemy — inaczej desktop SMTP próbuje wysłać do numeru telefonu
  // i dostajesz mglisty błąd serwera. Lepiej powiedzieć wprost.
  if (!isValidEmail(to)) return { ok: false, error: `Adres „${(to || "").trim()}" nie wygląda na e-mail (przykład: firma@domena.pl).` };
  if (!subject?.trim()) return { ok: false, error: "Pusty temat wiadomości." };
  if (!body?.trim()) return { ok: false, error: "Pusta treść wiadomości." };
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
  // Natywny Gmail na desktopie (ten sam token co kalendarz) — wysyłamy TYLKO gdy połączony,
  // by masowa wysyłka nie otwierała okna logowania przy każdym leadzie.
  if (canSendGmailNative()) {
    const bridge = (window as any).jarvisDesktop;
    const connected = !!(await bridge.googleStatus?.())?.connected;
    if (!connected) return { ok: false, error: "Połącz konto Google (⚙ → Integracje → „Połącz Kalendarz Google”) — jednorazowo, potem wysyłka maili działa sama." };
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
export async function sendTestEmail(toOverride?: string): Promise<{ ok: boolean; message: string }> {
  const s = store.settings;
  const to = (toOverride?.trim()) || s.smtpUser?.trim();
  if (!to) return { ok: false, message: "Najpierw wpisz swój adres e-mail (⚙ → Poczta) albo podaj adres testu." };
  if (!to.includes("@")) return { ok: false, message: `Adres „${to}" jest niepoprawny (brak @).` };
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
  // Zgodność kontaktu: doNotContact/optOut BLOKUJĄ wysyłkę — ale DRAFT (offer) już powstał i go zwracamy.
  const suppressed = contactSuppressionReason(lead);
  if (suppressed) return { ok: false, error: `Nie wysłano — ${suppressed}. Szkic przygotowany.`, offer: text };
  const { subject, body } = splitOffer(text, `Oferta dla ${lead.company}`, store.settings.emailSignature);
  const r = await sendOfferEmail(email, subject, body, lead.company);
  return { ...r, offer: text };
}

/**
 * Pure: czy leada wolno automatycznie zmailować? doNotContact/optOut BLOKUJĄ (przez
 * evaluateContactPolicy). Publiczny e-mail sam w sobie nie wymusza wysyłki — ale suppression
 * (doNotContact/optOut) zawsze wyklucza. Zwraca powód, gdy zablokowany.
 */
export function contactSuppressionReason(lead: Lead): string | null {
  const p = evaluateContactPolicy({
    hasEmail: !!leadEmailOf(lead),
    hasPhone: !!(lead.contact && !lead.contact.includes("@")),
    doNotContact: lead.doNotContact,
    optOut: lead.optOut,
  });
  return p.suppressionReason ?? null;
}

/**
 * Pure: podziel leady na cele masowej wysyłki i pominięte. Egzekwuje: poprawny e-mail, brak
 * wcześniejszej wysyłki ORAZ zgodność kontaktu (doNotContact/optOut). Jedno źródło dla licznika i wysyłki.
 */
export function eligibleForBulkSend(
  leads: Lead[],
  index: { companies: Set<string>; addresses: Set<string> },
): { targets: Lead[]; noEmail: number; alreadyEmailed: number; suppressed: number } {
  const withEmail = (leads || []).filter((l) => isValidEmail(leadEmailOf(l)));
  const noEmail = (leads || []).length - withEmail.length;
  const allowed = withEmail.filter((l) => !contactSuppressionReason(l)); // doNotContact/optOut → poza wysyłką
  const suppressed = withEmail.length - allowed.length;
  const targets = allowed.filter((l) => !wasLeadEmailed(index, l.company || "", leadEmailOf(l)));
  const alreadyEmailed = allowed.length - targets.length;
  return { targets, noEmail, alreadyEmailed, suppressed };
}

export interface BulkSendResult {
  total: number;
  sent: number;
  noEmail: number;
  alreadyEmailed: number;
  /** Pominięte z powodu zgodności kontaktu (doNotContact/optOut). */
  suppressed: number;
  failed: number;
  errors: string[];
}

/** E-mail leada: pole `email`, w razie braku `contact` (jeśli zawiera @). */
function leadEmailOf(l: Lead): string {
  const e = (l.email || "").trim();
  if (e.includes("@")) return e;
  const c = (l.contact || "").trim();
  return c.includes("@") ? c : "";
}

/** Indeks wysłanych maili (firmy + adresy) — zbudowany RAZ, by sprawdzanie „już mailowany" było O(1). */
export function buildSentIndex(sentBox: { company?: string; to?: string }[]): { companies: Set<string>; addresses: Set<string> } {
  const companies = new Set<string>();
  const addresses = new Set<string>();
  for (const m of sentBox || []) {
    const c = (m.company || "").trim().toLowerCase();
    if (c) companies.add(c);
    const a = (m.to || "").trim().toLowerCase();
    if (a) addresses.add(a);
  }
  return { companies, addresses };
}

/** Czy lead (po firmie LUB adresie) był już mailowany — wg indeksu. O(1). Zachowuje dawne dopasowanie. */
export function wasLeadEmailed(index: { companies: Set<string>; addresses: Set<string> }, company: string, email: string): boolean {
  const c = (company || "").trim().toLowerCase();
  const e = (email || "").trim().toLowerCase();
  return (!!c && index.companies.has(c)) || (!!e && index.addresses.has(e));
}

/**
 * Masowa wysyłka ofert do leadów — z zabezpieczeniami: tylko ci z adresem e-mail,
 * pomija JUŻ mailowanych (po firmie/adresie), limit na turę (domyślnie 25 — szanuje
 * dzienny limit Gmaila i chroni przed pomyłką). Sekwencyjnie, z aktualizacją statusu.
 */
export async function sendAllOffers(max = 25, onProgress?: (done: number, total: number) => void): Promise<BulkSendResult> {
  const leads = store.data.leads || [];
  const sentBox = store.data.sentMail || [];
  // Perf: indeks O(m) zamiast skanu sentBox dla KAŻDEGO leada (było O(leady × wysłane)).
  const sentIndex = buildSentIndex(sentBox);
  // Uprawnieni = poprawny e-mail + zgodność kontaktu (doNotContact/optOut BLOKUJĄ) + nie mailowani.
  // Egzekucja polityki kontaktu w REALNEJ masowej wysyłce, nie tylko w teście.
  const { targets, noEmail, alreadyEmailed, suppressed } = eligibleForBulkSend(leads, sentIndex);
  const batch = targets.slice(0, Math.max(0, max));
  const res: BulkSendResult = { total: leads.length, sent: 0, noEmail, alreadyEmailed, suppressed, failed: 0, errors: [] };
  for (let i = 0; i < batch.length; i++) {
    const l = batch[i];
    onProgress?.(i + 1, batch.length);
    const to = leadEmailOf(l);
    const r = await draftAndSendOffer(l, to);
    if (r.offer && r.offer !== l.offer) {
      store.setData((d) => { const x = d.leads.find((y) => y.id === l.id); if (x) { x.offer = r.offer; x.updatedAt = Date.now(); } });
    }
    if (r.ok) {
      res.sent++;
      store.setData((d) => {
        const x = d.leads.find((y) => y.id === l.id);
        if (x) { if (x.status === "new" || x.status === "contacted") x.status = "offer"; x.lastContactedAt = Date.now(); x.updatedAt = Date.now(); }
      });
    } else {
      res.failed++;
      if (res.errors.length < 3) res.errors.push(`${l.company}: ${r.error}`);
    }
  }
  return res;
}
