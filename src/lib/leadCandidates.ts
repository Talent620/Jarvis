// === Kolejka kandydatów zamiast zaśmiecania CRM (leadCandidates) ===
// Samo WYSZUKANIE nie zmienia bazy. discoverLeadCandidates() zwraca kandydatów (bez zapisu), a do
// CRM trafiają TYLKO ci zaznaczeni przez Marcina (importCandidates). Każdy kandydat ma źródło,
// czas pobrania, pewność, dowody, politykę przechowywania, możliwość kontaktu i ostrzeżenia jakości.
// Dane przykładowe (MOCK/SAMPLE) są WIDOCZNE jako przykładowe — JARVIS nie udaje, że są prawdziwe.
// Wszystkie źródła (OSM/Tavily/CEIDG/Google Places/mock) mają ten sam kontrakt. Czyste, S9-safe.

import type { RawLead } from "./leads";
import type { Lead } from "../types";

export type CandidateSource = "osm" | "tavily" | "ceidg" | "google_places" | "mock";
export type Contactability = "email" | "phone" | "form" | "none";
// Polityka przechowywania wg warunków źródła (Google Places: tylko placeId trwale itd.).
export type PersistencePolicy = "persist_ok" | "id_only" | "no_persist";

export interface LeadCandidate {
  id: string;              // stabilny klucz (sourceId albo z nazwy+źródła)
  company: string;
  source: CandidateSource;
  sourceUrl?: string;
  sourceId?: string;
  fetchedAt: number;
  confidence: number;      // 0..1
  evidence: string[];
  persistencePolicy: PersistencePolicy;
  contactability: Contactability;
  qualityWarnings: string[];
  isSample: boolean;       // MOCK/SAMPLE — widoczne jako przykład
  // Surowe pola do importu (dopiero po akceptacji):
  email?: string; phone?: string; url?: string; address?: string; niche?: string;
}

const POLICY: Record<CandidateSource, PersistencePolicy> = {
  osm: "persist_ok",
  tavily: "persist_ok",
  ceidg: "persist_ok",
  google_places: "id_only",   // Google: trwale tylko placeId; resztę odświeżaj wg warunków
  mock: "no_persist",         // przykładowe — nie utrwalamy jako prawdziwych
};

const keyOf = (company: string, source: string, sourceId?: string): string =>
  sourceId ? `${source}:${sourceId}` : `${source}:${company.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9ąćęłńóśźż-]/g, "")}`;

function contactabilityOf(r: { email?: string; phone?: string; website?: string }): Contactability {
  if (r.email) return "email";
  if (r.phone) return "phone";
  if (r.website) return "form"; // można próbować przez formularz na stronie
  return "none";
}

/** Pure: znormalizuj surowy wynik źródła do kandydata (BEZ zapisu). */
export function normalizeCandidate(
  r: RawLead,
  opts: { source: CandidateSource; now: number; sourceUrl?: string; sourceId?: string; isSample?: boolean },
): LeadCandidate {
  const warnings: string[] = [];
  if (!r.company?.trim()) warnings.push("brak nazwy firmy");
  if (!r.email && !r.phone && !r.website) warnings.push("brak jakiegokolwiek kontaktu");
  if (opts.isSample) warnings.push("dane PRZYKŁADOWE — nie kontaktuj jako realne");

  const contact = contactabilityOf(r);
  // Pewność: kontakt + strona + adres podnoszą; brak kontaktu i sample obniżają.
  let confidence = 0.4;
  if (r.email) confidence += 0.25;
  if (r.phone) confidence += 0.15;
  if (r.website) confidence += 0.1;
  if (r.address) confidence += 0.1;
  if (opts.isSample) confidence = Math.min(confidence, 0.2);
  confidence = Math.max(0, Math.min(1, confidence));

  const evidence: string[] = [];
  if (r.website) evidence.push(`www: ${r.website}`);
  if (r.address) evidence.push(`adres: ${r.address}`);
  if (r.hours) evidence.push(`godziny: ${r.hours}`);

  return {
    id: keyOf(r.company || "firma", opts.source, opts.sourceId),
    company: (r.company || "").trim() || "(bez nazwy)",
    source: opts.source,
    sourceUrl: opts.sourceUrl || r.website,
    sourceId: opts.sourceId,
    fetchedAt: opts.now,
    confidence,
    evidence,
    persistencePolicy: POLICY[opts.source],
    contactability: contact,
    qualityWarnings: warnings,
    isSample: !!opts.isSample,
    email: r.email, phone: r.phone, url: r.website, address: r.address, niche: r.kind,
  };
}

/** Pure: zamień surowe wyniki na kandydatów. NIE zapisuje niczego (kontrakt jednolity dla źródeł). */
export function discoverLeadCandidates(
  raws: RawLead[],
  opts: { source: CandidateSource; now: number; isSample?: boolean },
): LeadCandidate[] {
  const seen = new Set<string>();
  const out: LeadCandidate[] = [];
  for (const r of raws || []) {
    const c = normalizeCandidate(r, opts);
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Pure: kandydat → Lead (do importu). Respektuje persistencePolicy:
 * - id_only (Google Places): trwale TYLKO stabilny identyfikator (placeId) + nazwa; pól takich jak
 *   adres/e-mail/telefon NIE utrwalamy długoterminowo (zgodnie z warunkami Google — do odświeżenia).
 * - persist_ok (OSM/Tavily/CEIDG): pełne dane. Dane przykładowe oznaczamy w notatce.
 */
export function candidateToLead(c: LeadCandidate, now: number): Omit<Lead, "id"> {
  const idOnly = c.persistencePolicy === "id_only";
  const noteBits = [c.isSample ? "[PRZYKŁAD]" : "", `źródło: ${c.source}`, ...c.qualityWarnings];
  if (idOnly && c.sourceId) noteBits.push(`placeId: ${c.sourceId}`, "[Google — dane odśwież, nie utrwalamy adresu/kontaktu]");
  return {
    company: c.company,
    url: idOnly ? undefined : c.url,
    email: idOnly ? undefined : c.email,
    contact: idOnly ? undefined : (c.email || c.phone),
    address: idOnly ? undefined : c.address,
    niche: c.niche,
    note: noteBits.filter(Boolean).join(" · "),
    crmId: idOnly ? c.sourceId : undefined, // stabilny identyfikator miejsca
    status: "new",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Pure: zaimportuj TYLKO zaznaczonych kandydatów do listy leadów (dedup po nazwie). Zwraca nowe
 * leady do dodania — samo wyszukanie niczego nie zmienia; to jedyna droga do CRM.
 */
export function importCandidates(
  existing: Lead[],
  selected: LeadCandidate[],
  opts: { now: number; makeId: (c: LeadCandidate, i: number) => string },
): Lead[] {
  const have = new Set((existing || []).map((l) => (l.company || "").trim().toLowerCase()));
  const added: Lead[] = [];
  selected.forEach((c, i) => {
    // no_persist (mock/SAMPLE) NIE trafia do CRM jako prawdziwy lead — nie udajemy, że przykład jest realny.
    if (c.persistencePolicy === "no_persist") return;
    const key = c.company.trim().toLowerCase();
    if (have.has(key)) return;
    have.add(key);
    added.push({ id: opts.makeId(c, i), ...candidateToLead(c, opts.now) });
  });
  return added;
}
