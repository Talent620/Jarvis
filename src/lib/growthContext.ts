// === Most Lead → spersonalizowane demo (growthContext) ===
// Marcin nie przepisuje ręcznie żadnej informacji o leadzie. Z danych leada budujemy GrowthContext
// (firma, branża, lokalizacja, strona, kontakt, wykryte problemy, źródła i dowody), który zasila
// Kreator stron gotowym briefem. Czysty i testowalny; UI tylko go przenosi. S9-safe.

import type { Lead, FinanceProject } from "../types";
import type { ClientBrief } from "./webgen";

export interface GrowthContext {
  leadId: string;
  company: string;
  industry?: string;
  location?: string;
  website?: string;
  contact?: string;
  problems: string[];   // wykryte problemy → uzasadnienie demo
  sources: string[];    // skąd dane (OSM/ręcznie/salesos)
  evidence: string[];   // dostępne dowody (audyt, notatki)
}

/** Pure: wykryj problemy firmy z danych leada (heurystyki, bez zmyślania). */
export function detectProblems(lead: Lead): string[] {
  const p: string[] = [];
  if (!lead.url) p.push("brak strony WWW — duża szansa na demo");
  const audit = lead.intel?.audit;
  if (audit?.ok) {
    if (audit.viewport === false) p.push("strona nieprzyjazna mobilnie (brak viewport)");
    if (audit.https === false) p.push("brak HTTPS (kłódki) — spadek zaufania i SEO");
    if (audit.metaDesc === false) p.push("brak opisu w Google (meta description)");
  }
  if (!lead.email) p.push("brak kontaktu e-mail w bazie");
  return p;
}

/** Pure: zbuduj kontekst wzrostu z leada (źródło danych dla kreatora). */
export function buildGrowthContext(lead: Lead): GrowthContext {
  const sources: string[] = [];
  if (lead.origin === "salesos") sources.push("AI Sales OS");
  if (lead.url || lead.address) sources.push("OpenStreetMap");
  if (!sources.length) sources.push("ręcznie");

  const evidence: string[] = [];
  if (lead.intel?.audit) evidence.push("audyt strony");
  const lastNote = lead.notes && lead.notes.length ? lead.notes[lead.notes.length - 1]?.text : lead.note;
  if (lastNote) evidence.push("notatka z kontaktu");

  return {
    leadId: lead.id,
    company: lead.company,
    industry: lead.niche || undefined,
    location: lead.location || lead.address || undefined,
    website: lead.url || undefined,
    contact: lead.email || lead.contact || undefined,
    problems: detectProblems(lead),
    sources,
    evidence,
  };
}

/** Pure: przełóż GrowthContext na brief kreatora (Marcin nie wpisuje niczego ręcznie). */
export function growthContextToBrief(ctx: GrowthContext): ClientBrief {
  const extras: string[] = [];
  if (ctx.problems.length) extras.push(`Problemy do rozwiązania: ${ctx.problems.join("; ")}`);
  if (ctx.website) extras.push(`Obecna strona: ${ctx.website}`);
  if (ctx.location) extras.push(`Lokalizacja: ${ctx.location}`);
  return {
    business: ctx.company,
    industry: ctx.industry,
    goal: "Pozyskać klientów — demo sprzedażowe pokazujące, co możemy zrobić dla tej firmy",
    contact: ctx.contact,
    extra: extras.join("\n") || undefined,
  };
}

/** Pure: nazwa projektu demo dla kreatora. */
export function demoProjectName(ctx: GrowthContext): string {
  return `Demo — ${ctx.company}`;
}

// — Handoff Klient → Finanse (bez ręcznego przepisywania firmy; bez duplikatów) —

/** Pure: czy istnieje już projekt finansowy dla firmy tego leada (dedup po nazwie klienta)? */
export function hasProjectForClient(projects: FinanceProject[], lead: Pick<Lead, "company">): boolean {
  const c = (lead.company || "").trim().toLowerCase();
  if (!c) return false;
  return (projects || []).some((p) => (p.client || "").trim().toLowerCase() === c);
}

/**
 * Pure: SZKIC projektu finansowego z leada — nazwa, klient i wartość wypełnione automatycznie.
 * To tylko DRAFT (bez id) — utworzenie wymaga zatwierdzenia w UI. Status startowy: w realizacji.
 */
export function leadToProjectDraft(lead: Lead, now: number): Omit<FinanceProject, "id"> {
  return {
    name: `Projekt — ${lead.company}`,
    client: lead.company,
    status: "w_realizacji",
    amount: typeof lead.value === "number" && lead.value > 0 ? lead.value : 0,
    startAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
