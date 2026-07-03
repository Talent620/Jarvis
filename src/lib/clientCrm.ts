// === Klient 360 (clientCrm) — porządna kartoteka klienta z tego, co JUŻ wiemy ===
// PO CO: dane o kliencie były rozsiane — notatki w leadzie, wysłane maile w Skrzynce,
// pieniądze w Finansach. Prawdziwe CRM pokazuje JEDNĄ oś czasu („co się działo"),
// JEDNĄ kartę podsumowania i JEDEN jasny następny krok. Ten moduł SKŁADA istniejące
// źródła (leadTimeline + sentMail + financeProjects + relationshipStatus) — niczego
// nie duplikuje i nie zmyśla: brak danych = uczciwe puste pole. Czyste funkcje. S9-safe.

import type { Lead, SentMail, FinanceProject } from "../types";
import { leadTimeline } from "./leadNotes";
import { relationshipStatus } from "./salesEngine";

export interface TimelineEntry {
  at: number;
  kind: "note" | "email" | "finance";
  text: string;
}

/** Pure: czy wpis Skrzynki wysłanych dotyczy tego leada (firma LUB adres, case-insensitive). */
export function mailMatchesLead(lead: Pick<Lead, "company" | "email" | "contact">, m: Pick<SentMail, "company" | "to">): boolean {
  const company = (lead.company || "").trim().toLowerCase();
  const mCompany = (m.company || "").trim().toLowerCase();
  if (company && mCompany && company === mCompany) return true;
  const addr = (m.to || "").trim().toLowerCase();
  if (!addr) return false;
  const leadEmail = (lead.email || "").trim().toLowerCase();
  const contact = (lead.contact || "").trim().toLowerCase();
  return (!!leadEmail && addr === leadEmail) || (contact.includes("@") && addr === contact);
}

/** Pure: czy projekt finansowy należy do leada (po ID; fallback: nazwa klienta = firma). */
export function financeMatchesLead(lead: Pick<Lead, "id" | "company">, p: Pick<FinanceProject, "leadId" | "client">): boolean {
  if (p.leadId && p.leadId === lead.id) return true;
  const c = (p.client || "").trim().toLowerCase();
  return !!c && c === (lead.company || "").trim().toLowerCase();
}

/**
 * Pure: SCALONA oś czasu klienta — notatki (dziennik kontaktu) + wysłane maile + zdarzenia
 * finansowe (utworzenie projektu, płatność), chronologicznie od najnowszych. Jedno miejsce
 * odpowiada na „co się działo z tym klientem".
 */
export function clientTimeline(
  lead: Lead,
  sentMail: SentMail[] | undefined,
  financeProjects: FinanceProject[] | undefined,
  limit = 30,
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const n of leadTimeline(lead)) out.push({ at: n.at, kind: "note", text: n.text });
  for (const m of sentMail || []) {
    if (mailMatchesLead(lead, m)) out.push({ at: m.at, kind: "email", text: `Wysłano e-mail (${m.via}): ${m.subject}` });
  }
  for (const p of financeProjects || []) {
    if (!financeMatchesLead(lead, p)) continue;
    if (p.createdAt) out.push({ at: p.createdAt, kind: "finance", text: `Projekt „${p.name}” (${p.amount} zł)` });
    if (p.paidAt && p.paidAmount) out.push({ at: p.paidAt, kind: "finance", text: `Płatność ${p.paidAmount} zł za „${p.name}”` });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, Math.max(1, limit));
}

export interface ClientCard {
  /** Wartość dealu z leada (PLN) — undefined, gdy nie wpisano (uczciwie, nie 0). */
  value?: number;
  /** Ostatni ślad kontaktu: kiedy i co to było (mail/notatka). Undefined = nigdy. */
  lastTouchAt?: number;
  lastTouchWhat?: string;
  /** Ile maili realnie wysłano do tego klienta (z potwierdzonej Skrzynki). */
  emailCount: number;
  /** Finanse powiązane z klientem: liczba projektów, suma netto, suma wpłat. */
  financeCount: number;
  financeTotal: number;
  financePaid: number;
  /** JEDEN jasny następny krok (nextActionFor). */
  nextAction: string;
  /** Follow-up zaległy? (do wyróżnienia w UI) */
  overdue: boolean;
}

/** Pure: JEDEN jasny następny krok dla klienta — z realnego stanu, bez zgadywania. */
export function nextActionFor(lead: Lead, now = Date.now()): string {
  if (lead.optOut) return "⛔ Kontakt wypisał się (opt-out) — nie kontaktować.";
  if (lead.doNotContact) return "🚫 Oznaczone „nie kontaktować” — tylko praca wewnętrzna.";
  if (lead.status === "won") return "🏆 Wygrane — dopilnuj realizacji i płatności (💰 Finanse).";
  if (lead.status === "lost") return "🗄 Zamknięte — nic do zrobienia.";
  const rel = relationshipStatus(lead, now);
  if (rel.overdue) return "⚠ Follow-up ZALEGŁY — zadzwoń lub napisz dziś.";
  if (rel.nextFollowUpAt) {
    return `🔁 Follow-up zaplanowany: ${new Date(rel.nextFollowUpAt).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}.`;
  }
  if (lead.status === "new") return "👋 Pierwszy kontakt: zadzwoń albo wyślij ofertę.";
  if (lead.status === "offer") return "✉ Oferta wysłana — zaplanuj follow-up (przycisk ⏰ niżej).";
  return "📞 Po kontakcie — zaplanuj follow-up, żeby temat nie umarł.";
}

/** Pure: karta „Klient 360" — zwarte podsumowanie z istniejących źródeł (zero zmyślania). */
export function clientCard(
  lead: Lead,
  sentMail: SentMail[] | undefined,
  financeProjects: FinanceProject[] | undefined,
  now = Date.now(),
): ClientCard {
  const mails = (sentMail || []).filter((m) => mailMatchesLead(lead, m));
  const fin = (financeProjects || []).filter((p) => financeMatchesLead(lead, p));
  const financeTotal = fin.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const financePaid = fin.reduce((s, p) => s + (Number(p.paidAmount) || 0), 0);

  // Ostatni ślad: świeższe z (ostatni mail, ostatnia notatka, lastContactedAt).
  const lastMailAt = mails.length ? Math.max(...mails.map((m) => m.at)) : 0;
  const notes = leadTimeline(lead);
  const lastNoteAt = notes.length ? notes[0].at : 0;
  const lastContact = lead.lastContactedAt || 0;
  const lastTouchAt = Math.max(lastMailAt, lastNoteAt, lastContact) || undefined;
  const lastTouchWhat = !lastTouchAt
    ? undefined
    : lastTouchAt === lastMailAt
      ? "e-mail"
      : lastTouchAt === lastNoteAt
        ? "notatka"
        : "kontakt";

  return {
    value: typeof lead.value === "number" && lead.value > 0 ? lead.value : undefined,
    lastTouchAt,
    lastTouchWhat,
    emailCount: mails.length,
    financeCount: fin.length,
    financeTotal,
    financePaid,
    nextAction: nextActionFor(lead, now),
    overdue: relationshipStatus(lead, now).overdue,
  };
}

/** Pure: znacznik czasu przypomnienia „za N dni o 9:00 lokalnie" (przewidywalny, nie środek nocy). */
export function reminderInDays(days: number, now = Date.now()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + Math.max(1, Math.floor(days)));
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}
