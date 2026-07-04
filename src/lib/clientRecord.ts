// === Rekord klienta CRM (clientRecord) — model widoku „Panelu Klienta" ===
// PO CO: „porządne CRM" pokazuje klienta jako JEDEN, kompletny rekord: kim jest, na jakim etapie
// lejka, ile jest wart, co się z nim działo i co zrobić dalej. Ten moduł składa gotowy model
// widoku z ISTNIEJĄCYCH źródeł (lead + clientCrm: karta/oś czasu/następny krok) i dokłada rzeczy
// CRM-owe, których brakowało: etap lejka jako oś, etykiety/segmenty, higiena danych.
// Czyste funkcje — testowalne bez UI. S9-safe (bez /u, \p{...}, lookbehind).
//
// RESEARCH (co ma porządne CRM — Salesforce/HubSpot/Pipedrive) i pokrycie w JARVIS:
//  1. Tożsamość i kontakt (firma, osoby, e-mail/tel/adres/www)      — JEST (lead)
//  2. Szansa/deal: etap lejka + wartość + następny krok             — TU (stage + value + nextAction)
//  3. Oś czasu aktywności (rozmowy/maile/spotkania) chronologicznie  — JEST (clientTimeline)
//  4. Zadania i przypomnienia z terminem, kadencja follow-up         — JEST (reminderInDays/relationship)
//  5. Komunikacja: historia maili + kontakt jednym kliknięciem       — JEST (sentMail + tel/mailto)
//  6. Notatki datowane                                              — JEST (leadNotes)
//  7. Finanse: projekty, wartość, wpłaty                            — JEST (financeProjects)
//  8. Segmentacja/etykiety                                          — TU (tags, dodane do modelu)
//  9. Insighty: świeżość kontaktu, zdrowie, następny-najlepszy-ruch  — JEST (clientCard/predictions)
// 10. Szybkie akcje (zadzwoń/mail/przypomnij/notatka/zmień etap)     — panel (thin) na tych funkcjach

import type { Lead, SentMail, FinanceProject, LeadStatus } from "../types";
import { clientCard, clientTimeline, type ClientCard, type TimelineEntry } from "./clientCrm";

export interface PipelineStage {
  id: LeadStatus;
  label: string;
  /** Postęp w lejku 0..1 (do paska). „lost" = 0 (wypadł). */
  progress: number;
  /** Czy to etap „w grze" (nie wygrany/przegrany) — do liczenia otwartego pipeline. */
  open: boolean;
}

/** Kolejność i etykiety etapów lejka — jedno źródło prawdy dla osi i selektora. */
export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "new", label: "Nowy", progress: 0.1, open: true },
  { id: "contacted", label: "Kontakt", progress: 0.4, open: true },
  { id: "offer", label: "Oferta", progress: 0.7, open: true },
  { id: "won", label: "Klient", progress: 1, open: false },
  { id: "lost", label: "Odrzucony", progress: 0, open: false },
];

/** Pure: postęp lejka 0..1 dla statusu (do paska). Nieznany status → 0. */
export function pipelineProgress(status: LeadStatus): number {
  return PIPELINE_STAGES.find((s) => s.id === status)?.progress ?? 0;
}

/** Pure: etykieta etapu (do nagłówka). */
export function stageLabel(status: LeadStatus): string {
  return PIPELINE_STAGES.find((s) => s.id === status)?.label ?? status;
}

export interface ClientRecord {
  id: string;
  company: string;
  /** Kanały kontaktu wyłuskane z leada (do chipów: telefon/e-mail/www/adres). */
  email?: string;
  phone?: string;
  url?: string;
  address?: string;
  hours?: string;
  status: LeadStatus;
  stageLabel: string;
  progress: number;
  tags: string[];
  card: ClientCard;
  timeline: TimelineEntry[];
  /** Zgodność kontaktu — panel pokazuje ostrzeżenie i blokuje wysyłkę. */
  doNotContact: boolean;
  optOut: boolean;
}

/** Pure: e-mail leada (pole email, w razie braku contact jeśli zawiera @). */
function leadEmail(l: Lead): string | undefined {
  const e = (l.email || "").trim();
  if (e.includes("@")) return e;
  const c = (l.contact || "").trim();
  return c.includes("@") ? c : undefined;
}
/** Pure: telefon leada (contact, jeśli NIE jest adresem e-mail). */
function leadPhone(l: Lead): string | undefined {
  const c = (l.contact || "").trim();
  return c && !c.includes("@") ? c : undefined;
}

/**
 * Pure: zbuduj kompletny rekord klienta do „Panelu Klienta". Składa istniejące źródła —
 * niczego nie zmyśla (puste pola zostają puste). `timelineLimit` tnie oś do sensownej długości.
 */
export function clientRecord(
  lead: Lead,
  sentMail: SentMail[] | undefined,
  financeProjects: FinanceProject[] | undefined,
  now = Date.now(),
  timelineLimit = 40,
): ClientRecord {
  return {
    id: lead.id,
    company: lead.company,
    email: leadEmail(lead),
    phone: leadPhone(lead),
    url: (lead.url || "").trim() || undefined,
    address: (lead.address || "").trim() || undefined,
    hours: (lead.hours || "").trim() || undefined,
    status: lead.status,
    stageLabel: stageLabel(lead.status),
    progress: pipelineProgress(lead.status),
    tags: normalizeTags(lead.tags),
    card: clientCard(lead, sentMail, financeProjects, now),
    timeline: clientTimeline(lead, sentMail, financeProjects, timelineLimit),
    doNotContact: !!lead.doNotContact,
    optOut: !!lead.optOut,
  };
}

// — Etykiety/segmenty (czysta logika, bez duplikatów, przycięte) —

/** Pure: znormalizuj etykietę (trim, spójne małe litery na początku dla dedupu, limit długości). */
export function normalizeTag(tag: string): string {
  return (tag || "").trim().replace(/\s+/g, " ").slice(0, 30);
}

/** Pure: oczyść listę etykiet — bez pustych, bez duplikatów (case-insensitive), maks. 12. */
export function normalizeTags(tags: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags || []) {
    const t = normalizeTag(raw);
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

/** Pure: dodaj etykietę (idempotentnie, case-insensitive). Zwraca nową listę. */
export function addTag(tags: string[] | undefined, tag: string): string[] {
  const t = normalizeTag(tag);
  if (!t) return normalizeTags(tags);
  const cur = normalizeTags(tags);
  if (cur.some((x) => x.toLowerCase() === t.toLowerCase())) return cur;
  return normalizeTags([...cur, t]);
}

/** Pure: usuń etykietę (case-insensitive). Zwraca nową listę. */
export function removeTag(tags: string[] | undefined, tag: string): string[] {
  const t = normalizeTag(tag).toLowerCase();
  return normalizeTags(tags).filter((x) => x.toLowerCase() !== t);
}

/** Pure: podpowiedzi etykiet z danych leada (nisza/lokalizacja) + kanoniczne segmenty. */
export function suggestedTags(lead: Pick<Lead, "niche" | "location" | "tags">): string[] {
  const base = ["gorący", "VIP", "polecenie", "do oddzwonienia"];
  const fromLead = [lead.niche, lead.location].map((s) => normalizeTag(s || "")).filter(Boolean);
  const have = new Set(normalizeTags(lead.tags).map((t) => t.toLowerCase()));
  return normalizeTags([...fromLead, ...base]).filter((t) => !have.has(t.toLowerCase())).slice(0, 6);
}
