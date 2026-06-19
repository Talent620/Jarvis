import { store } from "./store";
import type { Lead, LeadStatus, SentMail } from "../types";

// === Silnik sprzedaży — to, co realnie domyka transakcje (= pieniądze) ===
//  1) GODZINY OTWARCIA: parsuje opening_hours z OSM → wiesz, KOMU dzwonić TERAZ
//     (firma otwarta = odbierze; zamknięta = nie marnujesz telefonu).
//  2) FOLLOW-UPY: 80% sprzedaży dzieje się po 2.–5. kontakcie, a większość ludzi
//     odpuszcza po pierwszym. JARVIS pilnuje ponagleń i pisze je za Ciebie.
//  3) PLAN NA DZIŚ: łączy jedno z drugim w konkretną listę działań.
//  4) PROGNOZA + EKSPORT CSV: ile realnie wisi w lejku, kopia leadów na zewnątrz.

// --- 1. Godziny otwarcia (parser podzbioru formatu OSM opening_hours) ---

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]; // index = Date.getDay()
const DAY_IDX: Record<string, number> = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

/** Zbiór dni z zapisu typu „Mo-Fr" / „Mo,We,Fr" / „Sa". */
function parseDays(spec: string): Set<number> {
  const set = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^([A-Z][a-z])(?:-([A-Z][a-z]))?$/.exec(part.trim());
    if (!m) continue;
    const a = DAY_IDX[m[1]];
    if (a === undefined) continue;
    if (!m[2]) { set.add(a); continue; }
    const b = DAY_IDX[m[2]];
    if (b === undefined) continue;
    for (let i = 0; i < 7; i++) { const d = (a + i) % 7; set.add(d); if (d === b) break; }
  }
  return set;
}

/** Minuty od północy dla „HH:MM". */
function toMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Czy firma jest otwarta w danym momencie wg opening_hours.
 * Zwraca true/false, albo null gdy nie da się sparsować (nie zgadujemy).
 * Obsługuje: 24/7, „Mo-Fr 09:00-18:00", listy dni, kilka zakresów, „; Su off".
 */
export function isOpenNow(spec: string | undefined, now = new Date()): boolean | null {
  if (!spec?.trim()) return null;
  const s = spec.trim();
  if (/^24\s*\/\s*7$/.test(s)) return true;
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  let parsedAny = false; // czy udało się odczytać jakąkolwiek regułę godzinową

  for (const rule of s.split(";")) {
    const r = rule.trim();
    if (!r) continue;
    // „Mo-Fr off" / „Su off" → zamknięte w te dni.
    const offMatch = /^([A-Za-z,\- ]+?)\s+off$/i.exec(r);
    if (offMatch) {
      if (parseDays(offMatch[1]).has(day)) return false;
      continue;
    }
    // „Mo-Fr 09:00-18:00,14:00-18:00" lub samo „09:00-18:00" (= codziennie).
    const m = /^([A-Za-z][A-Za-z,\- ]*?)?\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})(?:\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*)$/.exec(r);
    if (!m) continue;
    parsedAny = true; // mamy zrozumiały harmonogram
    const days = m[1] ? parseDays(m[1]) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days.has(day)) continue;
    for (const range of m[2].split(",")) {
      const [from, to] = range.split("-").map((x) => toMin(x));
      if (from == null || to == null) continue;
      if (to > from ? minutes >= from && minutes < to : minutes >= from || minutes < to) return true;
    }
  }
  // Harmonogram zrozumiały, ale dziś/teraz poza nim → zamknięte. Nic nie zrozumieliśmy → brak danych.
  return parsedAny ? false : null;
}

/** Krótka etykieta statusu otwarcia do UI. */
export function openLabel(spec: string | undefined, now = new Date()): { open: boolean | null; text: string } {
  const open = isOpenNow(spec, now);
  if (open === null) return { open: null, text: "godziny nieznane" };
  return open ? { open: true, text: "otwarte teraz" } : { open: false, text: "zamknięte teraz" };
}

// --- 2. Lista „Dzwoń TERAZ" — gorące, niezaczepione, otwarte ---

const hasPhone = (l: Lead) => !!l.contact && !l.contact.includes("@");

/** Komu dzwonić w tej chwili: status „nowy", jest telefon, otwarte (lub nieznane), najgorętsze na górze. */
export function callNowList(leads: Lead[], now = new Date()): Lead[] {
  return leads
    .filter((l) => l.status === "new" && hasPhone(l) && isOpenNow(l.hours, now) !== false)
    .sort((a, b) => {
      const openA = isOpenNow(a.hours, now) === true ? 1 : 0;
      const openB = isOpenNow(b.hours, now) === true ? 1 : 0;
      if (openA !== openB) return openB - openA; // potwierdzone otwarte przed „nieznane"
      return (b.intel?.score ?? 0) - (a.intel?.score ?? 0);
    });
}

/** Wyszukiwarka po istniejącej liście leadów (firma, kontakt, nisza, miasto, notatka). */
export function searchLeads(leads: Lead[], q: string): Lead[] {
  const needle = (q || "").trim().toLowerCase();
  if (!needle) return leads;
  return leads.filter((l) => {
    const hay = [l.company, l.contact, l.niche, l.location, l.note, l.url].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(needle);
  });
}

/** Czy do tego leada wysłano już e-mail (po firmie lub adresie ze Skrzynki wysłanych). */
export function wasLeadEmailed(lead: Lead, sent: SentMail[]): boolean {
  if (!sent?.length) return false;
  const company = (lead.company || "").trim().toLowerCase();
  // E-mail leada bywa w polu `email` LUB w `contact` — sprawdzamy oba.
  const emails = [lead.email, lead.contact]
    .map((x) => (x || "").trim().toLowerCase())
    .filter((x) => x.includes("@"));
  return sent.some((m) => {
    const to = (m.to || "").trim().toLowerCase();
    return (!!company && (m.company || "").trim().toLowerCase() === company) || emails.includes(to);
  });
}

// --- 3. Follow-upy — ponaglenia, które domykają sprzedaż ---
const DAY_MS = 24 * 60 * 60 * 1000;
const FOLLOWUP_AFTER_DAYS = 3; // domyślny odstęp między kontaktami (gdy brak ustawienia)
const MAX_FOLLOWUPS = 4;       // po tylu odpuszczamy (nie nękamy)

/** Kadencja follow-upów z ustawień (dni). Domyślnie 3. */
function followUpDays(): number {
  const d = Number(store.settings.followUpDays);
  return d > 0 ? d : FOLLOWUP_AFTER_DAYS;
}

/** Efektywny termin następnego follow-upu: zaplanowany (`nextFollowUpAt`) albo „kontakt + N dni". Czysta. */
export function followUpDueAt(lead: Lead, days = followUpDays()): number {
  if (typeof lead.nextFollowUpAt === "number") return lead.nextFollowUpAt;
  return (lead.lastContactedAt ?? lead.updatedAt) + days * DAY_MS;
}

/** Leady, które dziś wymagają ponaglenia (zaczepione, brak odpowiedzi, nie za często). */
export function followUpsDue(leads: Lead[], now = Date.now()): Lead[] {
  const days = followUpDays();
  return leads
    .filter((l) => {
      if (l.status !== "contacted" && l.status !== "offer") return false;
      if ((l.followUpCount ?? 0) >= MAX_FOLLOWUPS) return false;
      return now >= followUpDueAt(l, days);
    })
    .sort((a, b) => followUpDueAt(a, days) - followUpDueAt(b, days));
}

/** Zaplanuj następny follow-up na konkretny moment (autonomia: JARVIS sam planuje kadencję). */
export function scheduleFollowUp(leadId: string, whenMs: number): void {
  store.setData((d) => {
    const l = d.leads.find((x) => x.id === leadId);
    if (!l) return;
    l.nextFollowUpAt = whenMs;
    l.updatedAt = Date.now();
  });
}

/** Przełóż follow-up o N dni od teraz (drzemka „nie dziś"). */
export function snoozeFollowUp(leadId: string, days = followUpDays(), now = Date.now()): void {
  scheduleFollowUp(leadId, now + days * DAY_MS);
}

/** Treść kolejnego follow-upu (eskaluje delikatnie, nigdy nachalnie). Czysta funkcja. */
export function followUpMessage(lead: Lead, attempt: number): string {
  const me = store.settings.userName && store.settings.userName !== "Sir" ? store.settings.userName : "";
  const sign = me ? `\nPozdrawiam,\n${me}` : "\nPozdrawiam";
  const company = lead.company;
  if (attempt <= 1)
    return `Dzień dobry,\n\nwracam do mojej wiadomości sprzed kilku dni w sprawie strony dla ${company}. Rozumiem, że to gorący okres — czy znajdą Państwo 10 minut na krótką rozmowę? Mam już gotowe demo do pokazania, bez żadnych zobowiązań z Państwa strony.${sign}`;
  if (attempt === 2)
    return `Dzień dobry,\n\njeszcze raz w sprawie ${company}. Przygotowałem konkretny pomysł, jak strona mogłaby przyciągać Państwu nowych klientów z Google. Mogę podesłać podgląd — wystarczy jedno „tak".${sign}`;
  return `Dzień dobry,\n\nto moja ostatnia wiadomość, żeby nie być natrętnym. Jeśli kwestia strony dla ${company} jest nieaktualna — rozumiem. A jeśli to po prostu nie był dobry moment, jestem do dyspozycji, kiedy będzie pasowało.${sign}`;
}

/** Oznacz lead jako zaczepiony (po wysłaniu maila/SMS/telefonie) — napędza follow-upy. */
export function markContacted(leadId: string, isFollowUp = false): void {
  const now = Date.now();
  const days = followUpDays();
  store.setData((d) => {
    const l = d.leads.find((x) => x.id === leadId);
    if (!l) return;
    l.lastContactedAt = now;
    if (isFollowUp) l.followUpCount = (l.followUpCount ?? 0) + 1;
    if (l.status === "new") l.status = "contacted";
    // Autonomia: każdy kontakt automatycznie planuje następny follow-up wg kadencji.
    l.nextFollowUpAt = now + days * DAY_MS;
    l.updatedAt = now;
  });
}

// --- 4. Prognoza lejka + eksport CSV ---

/** Prawdopodobieństwo domknięcia wg etapu (kalibracja zdroworozsądkowa). */
const WIN_PROB: Record<LeadStatus, number> = { new: 0.05, contacted: 0.15, offer: 0.4, won: 1, lost: 0 };

export interface Forecast { pipeline: number; expected: number; won: number; counts: Record<LeadStatus, number> }

/** Ile realnie wisi w lejku: wartość ważona prawdopodobieństwem etapu. */
export function pipelineForecast(leads: Lead[]): Forecast {
  const counts = { new: 0, contacted: 0, offer: 0, won: 0, lost: 0 } as Record<LeadStatus, number>;
  let pipeline = 0, expected = 0, won = 0;
  for (const l of leads) {
    counts[l.status]++;
    const v = l.value || 0;
    if (l.status === "won") won += v;
    else if (l.status !== "lost") { pipeline += v; expected += v * WIN_PROB[l.status]; }
  }
  return { pipeline, expected: Math.round(expected), won, counts };
}

/** Eksport leadów do CSV (Excel/Arkusze) — kopia i praca poza aplikacją. */
export function leadsToCsv(leads: Lead[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Firma", "Telefon", "E-mail", "Strona", "Adres", "Godziny", "Nisza", "Miasto", "Status", "Szansa", "Wartosc", "Notatka"];
  const rows = leads.map((l) => [
    l.company, hasPhone(l) ? l.contact : "", l.email || (l.contact?.includes("@") ? l.contact : ""),
    l.url || "", l.address || "", l.hours || "", l.niche || "", l.location || "",
    l.status, l.intel?.score ?? "", l.value ?? "", l.note || "",
  ].map(esc).join(","));
  return [head.join(","), ...rows].join("\r\n");
}

// Re-eksport DAYS, by inne moduły mogły mapować dzień, jeśli zajdzie potrzeba.
export { DAYS };
