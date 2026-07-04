// === Silnik autonomicznej kampanii ofertowej (auto-mail) ===
// PO CO: JARVIS ma UCZCIWIE i BEZPIECZNIE wysyłać oferty sam — powoli, w limitach, w pełni
// odwracalnie i zgodnie z RODO/PKE (art. 398). To NIE jest „masowy mailing": to pojedyncze
// wysyłki z twardymi bezpiecznikami. Silnik jest CZYSTY i testowalny (funkcje niżej), a cienki
// adapter `runOfferCampaignCycle()` wpina go w cykl aplikacji.
//
// Zasady (świadome, nienegocjowalne):
//   • Uzbrojenie tylko za JAWNĄ zgodą (outbound) — nigdy „samo z siebie".
//   • Każdy mail MUSI mieć stopkę zgodności (opt-out „STOP" + tożsamość nadawcy + podstawa RODO);
//     bez ważnej stopki wysyłka jest ZABLOKOWANA (fail-closed), nie „jakoś tam wysłana".
//   • Twarde limity: dzienny cap, throttling, limit całej kampanii, okno robocze, wygaśnięcie.
//   • Bezpiecznik: po serii błędów (albo błędzie auth/limit) kampania sama się WSTRZYMUJE.
//   • Nigdy nie wysyłamy do doNotContact/optOut ani do już zmailowanych (dedup w eligibleForBulkSend).
//   • Prawda działania: „wysłano" tylko po potwierdzeniu (ActionOutcome/SendResult), inaczej błąd.
// S9-safe: bez /u, \p{...}, lookbehind. Cudzysłowy zawsze „…” (curly-close), nigdy „…" (łamie esbuild).

import type { Lead, OfferCampaign, CampaignWorkingHours } from "../types";
import { store } from "./store";
import { splitOffer } from "./glinks";
import { draftOffer } from "./offer";
import {
  sendOfferEmail,
  contactSuppressionReason,
  eligibleForBulkSend,
  buildSentIndex,
  sentTodayCount,
  canSendDirect,
  type SendResult,
} from "./mailer";
import { grantOutboundScope } from "./permissions";

// — Domyślne, BEZPIECZNE wartości (z researchu deliverability + zdrowego rozsądku) —
export const DEFAULT_DAILY_LIMIT = 20;              // maks. maili/dobę (rozgrzana skrzynka)
export const DEFAULT_THROTTLE_MS = 90_000;          // min. 90 s między wysyłkami
export const DEFAULT_THROTTLE_JITTER_MS = 30_000;   // ±30 s losowego rozrzutu (naturalność)
export const DEFAULT_TOTAL_CAP = 200;               // twardy limit całej kampanii
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dni i kampania gaśnie
export const FAIL_STREAK_LIMIT = 4;                 // tyle błędów pod rząd → bezpiecznik
export const DEFAULT_WORKING_HOURS: CampaignWorkingHours = { startHour: 8, endHour: 18, days: [1, 2, 3, 4, 5] };

/** Powód, dla którego wysyłka w danym momencie jest niedozwolona (albo null = wolno). */
export interface CampaignGate {
  ok: boolean;
  reason?: string;
}

/** Kontekst decyzji wysyłkowej — wszystko, czego potrzebuje CZYSTA bramka. */
export interface CampaignSendContext {
  sentToday: number;   // ile maili wysłano dziś ŁĄCZNIE (z ręcznymi)
  footer: string;      // stopka zgodności, którą dołączymy do maila
  now: number;
}

/**
 * Pure: zbuduj STOPKĘ ZGODNOŚCI dołączaną do każdego maila kampanii. Zawiera trzy obowiązkowe
 * elementy: (1) jawny opt-out „STOP", (2) tożsamość nadawcy/administratora, (3) podstawę i źródło
 * danych (RODO art. 6 ust. 1 lit. f + art. 14). To NIE deklaracja „to legalne" — to spełnienie
 * minimalnych obowiązków informacyjnych. Podpis użytkownika (jeśli jest) idzie na górze.
 */
export function campaignFooter(signature?: string): string {
  const sig = (signature || "").trim();
  const lines = [
    "—",
    "Otrzymujesz tę wiadomość jako właściciel lub przedstawiciel firmy, której dane kontaktowe są publicznie dostępne w związku z jej działalnością.",
    "Podstawa: prawnie uzasadniony interes administratora (art. 6 ust. 1 lit. f RODO). Źródło danych: publiczne rejestry/strona firmy (art. 14 RODO).",
    "Nie chcesz więcej wiadomości? Odpisz jednym słowem „STOP” — natychmiast usunę Twój adres i nie napiszę ponownie.",
    "Administrator danych: Marcin Kubicki, v-ai.pl.",
  ];
  return (sig ? `${sig}\n\n` : "") + lines.join("\n");
}

/**
 * Pure: czy dana stopka spełnia minimum zgodności? Wymagane naraz: opt-out (STOP/wypisz/nie chcesz)
 * ORAZ tożsamość nadawcy (administrator/v-ai.pl/Kubicki). Pusta/kadłubowa stopka → false → wysyłka
 * zablokowana. To bezpiecznik przed „wysłaniem czegokolwiek" po wyczyszczeniu podpisu.
 */
export function footerValid(footer: string): boolean {
  const f = (footer || "").trim();
  if (f.length < 20) return false;
  const hasOptOut = /stop|wypisz|nie chcesz|zrezygnuj|opt-?out/i.test(f);
  const hasIdentity = /administrator|v-ai\.pl|kubicki/i.test(f);
  return hasOptOut && hasIdentity;
}

/**
 * Pure: dołącz stopkę zgodności do treści maila, jeśli jeszcze jej tam nie ma (idempotentnie —
 * nie dubluje). Gdy treść już zawiera ważny opt-out, zwracamy bez zmian.
 */
export function withComplianceFooter(body: string, footer: string): string {
  const b = (body || "").trim();
  if (footerValid(b)) return b; // treść już niesie zgodny opt-out — nie dubluj
  return `${b}\n\n${footer}`.trim();
}

/** Pure: czy `now` mieści się w oknie roboczym (godziny + dzień tygodnia, czas LOKALNY). */
export function isWithinWorkingHours(now: number, wh: CampaignWorkingHours): boolean {
  const d = new Date(now);
  const day = d.getDay();          // 0=niedziela … 6=sobota
  const hour = d.getHours();       // 0–23 lokalnie
  if (!wh.days.includes(day)) return false;
  return hour >= wh.startHour && hour < wh.endHour;
}

/** Pure: czy kampania wygasła (po startedAt+TTL)? */
export function campaignExpired(c: OfferCampaign, now: number): boolean {
  return now >= c.expiresAt;
}

/**
 * Pure: czy WOLNO teraz wysłać kolejny mail? Sprawdza po kolei (pierwszy blokujący wygrywa):
 * uzbrojenie → wygaśnięcie → wstrzymanie (bezpiecznik) → ważna stopka → limit kampanii →
 * dzienny limit → okno robocze → throttling. Zwraca powód, gdy zablokowane.
 */
export function campaignCanSendNow(c: OfferCampaign, ctx: CampaignSendContext): CampaignGate {
  if (!c.active) return { ok: false, reason: "Kampania nie jest uzbrojona." };
  if (campaignExpired(c, ctx.now)) return { ok: false, reason: "Kampania wygasła (limit czasu)." };
  if (c.pausedReason) return { ok: false, reason: `Kampania wstrzymana: ${c.pausedReason}` };
  if (!footerValid(ctx.footer)) return { ok: false, reason: "Brak zgodnej stopki (opt-out/tożsamość) — wysyłka zablokowana." };
  if (c.sentTotal >= c.totalCap) return { ok: false, reason: `Osiągnięto limit kampanii (${c.totalCap}).` };
  if (ctx.sentToday >= c.dailyLimit) return { ok: false, reason: `Osiągnięto dzienny limit (${c.dailyLimit}).` };
  if (!isWithinWorkingHours(ctx.now, c.workingHours)) return { ok: false, reason: "Poza oknem roboczym." };
  if (c.lastSentAt > 0 && ctx.now - c.lastSentAt < c.throttleMs) {
    return { ok: false, reason: "Throttling — za wcześnie na kolejną wysyłkę." };
  }
  return { ok: true };
}

/** Pure: efektywny odstęp throttlingu z rozrzutem (jitter). rnd∈[0,1) wstrzykiwalny do testów. */
export function nextThrottleMs(base: number, jitter: number, rnd: number): number {
  const spread = Math.floor((rnd * 2 - 1) * jitter); // [-jitter, +jitter)
  return Math.max(0, base + spread);
}

/** Pure: nowy stan po UDANEJ wysyłce — licznik +1, reset serii błędów, znacznik czasu. */
export function applySuccess(c: OfferCampaign, now: number): OfferCampaign {
  const sentTotal = c.sentTotal + 1;
  const done = sentTotal >= c.totalCap;
  return {
    ...c,
    sentTotal,
    lastSentAt: now,
    failStreak: 0,
    active: done ? false : c.active,
    pausedReason: done ? "Osiągnięto limit kampanii." : c.pausedReason,
  };
}

/** Rodzaj błędu wysyłki — auth/limit natychmiast wstrzymują (nie ma sensu tłuc dalej). */
export type SendFailureKind = "transient" | "auth" | "limit";

/** Pure: sklasyfikuj komunikat błędu dostawcy na rodzaj (do bezpiecznika). */
export function classifyFailure(error: string): SendFailureKind {
  const e = (error || "").toLowerCase();
  if (/auth|hasł|password|login|535|credential|oauth|token|połącz konto/.test(e)) return "auth";
  if (/limit|quota|rate|too many|421|450|throttle|spam|blocked|reputacj/.test(e)) return "limit";
  return "transient";
}

/**
 * Pure: nowy stan po BŁĘDZIE wysyłki. Seria błędów rośnie; gdy osiągnie próg — kampania się
 * WSTRZYMUJE (pausedReason). Błąd auth/limit wstrzymuje NATYCHMIAST (nie czekamy na serię).
 */
export function applyFailure(c: OfferCampaign, kind: SendFailureKind, now: number): OfferCampaign {
  const failStreak = c.failStreak + 1;
  const hardStop = kind === "auth" || kind === "limit";
  const tripped = hardStop || failStreak >= FAIL_STREAK_LIMIT;
  const reason = kind === "auth"
    ? "błąd logowania poczty — sprawdź dane w ⚙ → Poczta"
    : kind === "limit"
      ? "dostawca ogranicza wysyłkę (limit/reputacja) — odczekaj"
      : `${failStreak} błędy pod rząd — bezpiecznik`;
  return {
    ...c,
    lastSentAt: now,
    failStreak,
    pausedReason: tripped ? reason : c.pausedReason,
  };
}

/**
 * Pure: uzbrój nową kampanię z domyślnymi (bezpiecznymi) wartościami; opcjonalne nadpisania.
 * `now` wstrzykiwane (testy/determinizm).
 */
export function newCampaign(now: number, opts?: Partial<Pick<OfferCampaign, "dailyLimit" | "throttleMs" | "totalCap" | "workingHours">> & { ttlMs?: number }): OfferCampaign {
  return {
    active: true,
    dailyLimit: clampInt(opts?.dailyLimit, DEFAULT_DAILY_LIMIT, 1, 200),
    throttleMs: Math.max(10_000, opts?.throttleMs ?? DEFAULT_THROTTLE_MS),
    totalCap: clampInt(opts?.totalCap, DEFAULT_TOTAL_CAP, 1, 5000),
    sentTotal: 0,
    lastSentAt: 0,
    startedAt: now,
    expiresAt: now + (opts?.ttlMs ?? DEFAULT_TTL_MS),
    failStreak: 0,
    workingHours: opts?.workingHours ?? DEFAULT_WORKING_HOURS,
  };
}

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Pure: czytelny status kampanii dla człowieka (UI/głos/narzędzie). */
export function campaignStatusText(c: OfferCampaign | undefined, sentToday: number, now: number): string {
  if (!c) return "Auto-kampania: nieuzbrojona.";
  if (!c.active) return `Auto-kampania: wyłączona${c.pausedReason ? ` (${c.pausedReason})` : ""}. Wysłano łącznie: ${c.sentTotal}.`;
  if (campaignExpired(c, now)) return `Auto-kampania: wygasła. Wysłano łącznie: ${c.sentTotal}/${c.totalCap}.`;
  if (c.pausedReason) return `Auto-kampania: WSTRZYMANA — ${c.pausedReason}. Wysłano: ${c.sentTotal}/${c.totalCap}, dziś ${sentToday}/${c.dailyLimit}.`;
  const win = isWithinWorkingHours(now, c.workingHours) ? "w oknie" : "poza oknem (czeka)";
  const leftDays = Math.max(0, Math.ceil((c.expiresAt - now) / (24 * 60 * 60 * 1000)));
  return `Auto-kampania: AKTYWNA (${win}). Wysłano: ${c.sentTotal}/${c.totalCap}, dziś ${sentToday}/${c.dailyLimit}. Wygasa za ~${leftDays} dni.`;
}

// ————————————————————————————————————————————————————————————————
// Adapter (impure): wpięcie w cykl aplikacji. Cienki — cała logika decyzyjna jest w funkcjach wyżej.
// ————————————————————————————————————————————————————————————————

/** Blokada re-entrancji cyklu: gdy jeden bieg czeka na wysyłkę, kolejny tick nie startuje drugiego. */
let cycleInFlight = false;

/** Zapisz stan kampanii w ustawieniach (trwałość). */
function persistCampaign(c: OfferCampaign | undefined): void {
  store.setSettings({ offerCampaign: c });
}

/**
 * Uzbrój kampanię: nadaje ZAKRESOWĄ, wygasającą zgodę outbound (tylko wysyłka ofert) na czas TTL,
 * żeby cykl mógł wysyłać bez ekranu zgody przy każdym mailu — ale w jawnych, ograniczonych ramach.
 * Zwraca uzbrojoną kampanię. To jedyne miejsce, które WŁĄCZA auto-wysyłkę.
 */
export function armOfferCampaign(now = Date.now(), opts?: Parameters<typeof newCampaign>[1]): OfferCampaign {
  const c = newCampaign(now, opts);
  persistCampaign(c);
  // Zakres sesyjny: tylko narzędzia wysyłki ofert, wygasa razem z kampanią (nie „*", nie na stałe).
  grantOutboundScope(["send_offers_all", "gmail_send"], Math.max(0, c.expiresAt - now));
  return c;
}

/** Rozbrój kampanię (twardy STOP) — natychmiast, odwracalnie. */
export function disarmOfferCampaign(reason = "zatrzymana przez użytkownika"): void {
  const c = store.settings.offerCampaign;
  if (!c) return;
  persistCampaign({ ...c, active: false, pausedReason: reason });
}

/** Odczyt statusu z realnego store (do narzędzia/UI). */
export function offerCampaignStatus(now = Date.now()): string {
  const c = store.settings.offerCampaign;
  const sentToday = sentTodayCount(store.data.sentMail || [], now);
  return campaignStatusText(c, sentToday, now);
}

/** Wybierz JEDEN kolejny cel (po dedupie i suppression) — albo null, gdy nie ma kogo mailować. */
function nextTarget(): Lead | null {
  const leads = store.data.leads || [];
  const idx = buildSentIndex(store.data.sentMail || []);
  const { targets } = eligibleForBulkSend(leads, idx);
  return targets[0] || null;
}

/**
 * Wyślij ofertę do JEDNEGO leada z WYMUSZONĄ stopką zgodności. Mirror draftAndSendOffer, ale
 * podpis = stopka zgodności (opt-out/RODO), a suppression sprawdzamy PRZED wysyłką (fail-closed).
 */
async function sendOneWithFooter(lead: Lead, footer: string): Promise<SendResult & { offer?: string }> {
  let text = (lead.offer || "").trim();
  if (!text) text = (await draftOffer(lead)).trim();
  if (!text) return { ok: false, error: "Nie udało się napisać oferty (sprawdź klucz API)." };
  const suppressed = contactSuppressionReason(lead);
  if (suppressed) return { ok: false, error: `pominięto — ${suppressed}`, offer: text };
  const email = (lead.email || lead.contact || "").trim();
  const { subject, body } = splitOffer(text, `Oferta dla ${lead.company}`, footer);
  const r = await sendOfferEmail(email, subject, withComplianceFooter(body, footer), lead.company);
  return { ...r, offer: text };
}

/**
 * Cykl aplikacji: wyślij CO NAJWYŻEJ jeden mail, jeśli WSZYSTKIE bramki na to pozwalają.
 * Wołany co ~90 s z App.tsx. Idempotentny i cichy: gdy nie wolno — nic nie robi. Aktualizuje
 * stan kampanii (licznik/bezpiecznik/wygaśnięcie) i status leada po potwierdzonej wysyłce.
 * Zwraca krótki wynik (do logu/diagnostyki), NIE do UI jako „sukces" bez potwierdzenia.
 */
export async function runOfferCampaignCycle(now = Date.now()): Promise<{ sent: boolean; reason?: string }> {
  const c = store.settings.offerCampaign;
  if (!c || !c.active) return { sent: false, reason: "nieaktywna" };

  // Auto-wygaśnięcie: sama gaśnie po TTL (nie wisi „otwarta" w nieskończoność).
  if (campaignExpired(c, now)) {
    persistCampaign({ ...c, active: false, pausedReason: "wygasła (limit czasu)" });
    return { sent: false, reason: "wygasła" };
  }
  // Twardy warunek techniczny: bez skonfigurowanej wysyłki nie udajemy, że coś idzie.
  if (!canSendDirect()) return { sent: false, reason: "brak skonfigurowanej wysyłki" };

  // BEZPIECZNIK RE-ENTRANCJI: cykl czeka na draftOffer (generacja AI) + wysyłkę — to potrafi
  // trwać dłużej niż odstęp ticka (90 s). Bez tej blokady drugi tick wszedłby w cykl, PRZED
  // zapisaniem lastSentAt, przeczytał ten sam stan/licznik i wysłał DRUGI mail — omijając
  // throttling i dzienny limit. Jedna wysyłka na raz, kropka.
  if (cycleInFlight) return { sent: false, reason: "cykl już trwa" };
  cycleInFlight = true;
  try {
    return await runCycleGuarded(c, now);
  } finally {
    cycleInFlight = false;
  }
}

/** Wewnętrzny bieg cyklu (chroniony przez cycleInFlight w runOfferCampaignCycle). */
async function runCycleGuarded(c: OfferCampaign, now: number): Promise<{ sent: boolean; reason?: string }> {
  const footer = campaignFooter(store.settings.emailSignature);
  const sentToday = sentTodayCount(store.data.sentMail || [], now);
  const gate = campaignCanSendNow(c, { sentToday, footer, now });
  if (!gate.ok) return { sent: false, reason: gate.reason };

  const lead = nextTarget();
  if (!lead) {
    // Nie ma kogo mailować — kończymy kampanię (nie zostawiamy „aktywnej" bez celów).
    persistCampaign({ ...c, active: false, pausedReason: "brak kolejnych leadów do wysyłki" });
    return { sent: false, reason: "brak leadów" };
  }

  let r: SendResult & { offer?: string };
  try {
    r = await sendOneWithFooter(lead, footer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    persistCampaign(applyFailure(store.settings.offerCampaign || c, classifyFailure(msg), now));
    return { sent: false, reason: `błąd: ${msg}` };
  }

  // Zapisz świeży szkic w leadzie (jeśli powstał) — niezależnie od wyniku wysyłki.
  if (r.offer && r.offer !== lead.offer) {
    store.setData((d) => { const x = d.leads.find((y) => y.id === lead.id); if (x) { x.offer = r.offer; x.updatedAt = now; } });
  }

  const fresh = store.settings.offerCampaign || c; // odczyt najświeższego stanu (mógł się zmienić)
  if (r.ok) {
    persistCampaign(applySuccess(fresh, now));
    store.setData((d) => {
      const x = d.leads.find((y) => y.id === lead.id);
      if (x) { if (x.status === "new" || x.status === "contacted") x.status = "offer"; x.lastContactedAt = now; x.updatedAt = now; }
    });
    return { sent: true };
  }

  // Suppression (doNotContact/optOut) NIE jest błędem dostawcy — nie licz go do bezpiecznika,
  // po prostu przejdź dalej (ten lead i tak jest wykluczony w eligibleForBulkSend na przyszłość).
  const err = r.error || "nieznany błąd";
  if (/pominięto —/.test(err)) {
    persistCampaign({ ...fresh, lastSentAt: now }); // odczekaj throttling, spróbuj innego w kolejnym cyklu
    return { sent: false, reason: err };
  }
  persistCampaign(applyFailure(fresh, classifyFailure(err), now));
  return { sent: false, reason: err };
}
