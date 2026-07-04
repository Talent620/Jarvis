// === Egzekwowanie polityki źródeł i kontaktu w REALNYCH operacjach — testy ===
// DoD: polityka działa przez prawdziwe operacje (masowa wysyłka, import), nie tylko osobno.
import { describe, it, expect } from "vitest";
import { eligibleForBulkSend, contactSuppressionReason, buildSentIndex } from "../src/lib/mailer";
import { discoverLeadCandidates, importCandidates, candidateToLead, normalizeCandidate } from "../src/lib/leadCandidates";
import type { Lead } from "../src/types";
import type { RawLead } from "../src/lib/leads";

const NOW = 19_000_000_000;
const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "X", status: "new", createdAt: NOW, updatedAt: NOW, ...over });
const raw = (over: Partial<RawLead>): RawLead => ({ company: "Firma", hasWebsite: false, ...over });

describe("kontakt: masowa wysyłka respektuje doNotContact/optOut", () => {
  const idx = buildSentIndex([]);
  it("doNotContact i optOut są POMIJANE w masowej wysyłce (suppressed)", () => {
    const leads = [
      lead({ id: "a", company: "Alfa", email: "a@a.pl" }),
      lead({ id: "b", company: "Beta", email: "b@b.pl", doNotContact: true }),
      lead({ id: "c", company: "Gamma", email: "c@c.pl", optOut: true }),
    ];
    const r = eligibleForBulkSend(leads, idx);
    expect(r.targets.map((l) => l.id)).toEqual(["a"]); // tylko dozwolony
    expect(r.suppressed).toBe(2);
  });

  it("contactSuppressionReason: doNotContact/optOut → powód; zwykły → null", () => {
    expect(contactSuppressionReason(lead({ email: "a@a.pl", doNotContact: true }))).toMatch(/doNotContact/);
    expect(contactSuppressionReason(lead({ email: "a@a.pl", optOut: true }))).toMatch(/opt-out/i);
    expect(contactSuppressionReason(lead({ email: "a@a.pl" }))).toBeNull();
  });

  it("bez e-maila → noEmail; już mailowany → alreadyEmailed", () => {
    const idx2 = buildSentIndex([{ company: "Alfa" }]);
    const r = eligibleForBulkSend([lead({ company: "Alfa", email: "a@a.pl" }), lead({ company: "Beta" })], idx2);
    expect(r.noEmail).toBe(1);
    expect(r.alreadyEmailed).toBe(1);
    expect(r.targets).toHaveLength(0);
  });
});

describe("źródła: provenance zachowane (Tavily ≠ OSM)", () => {
  it("wynik z sieci dostaje source tavily, nie osm", () => {
    const osm = discoverLeadCandidates([raw({ company: "Alfa" })], { source: "osm", now: NOW });
    const web = discoverLeadCandidates([raw({ company: "Beta" })], { source: "tavily", now: NOW });
    expect(osm[0].source).toBe("osm");
    expect(web[0].source).toBe("tavily"); // NIE oznaczony jako OSM
  });
});

describe("import: persistencePolicy egzekwowane", () => {
  it("mock/no_persist NIE jest importowany jako prawdziwy lead", () => {
    const mockCand = normalizeCandidate(raw({ company: "Przykład", email: "x@x.pl" }), { source: "mock", now: NOW, isSample: true });
    const added = importCandidates([], [mockCand], { now: NOW, makeId: () => "id" });
    expect(added).toHaveLength(0); // no_persist odrzucony
  });

  it("id_only (Google) utrwala TYLKO placeId + nazwę, nie adres/e-mail", () => {
    const g = normalizeCandidate(raw({ company: "Salon", email: "s@s.pl", address: "Kraków", website: "https://s.pl" }), { source: "google_places", now: NOW, sourceId: "PLACE1" });
    const l = candidateToLead(g, NOW);
    expect(l.company).toBe("Salon");
    expect(l.crmId).toBe("PLACE1");     // stabilny identyfikator
    expect(l.email).toBeUndefined();    // niedozwolone pola nieutrwalone
    expect(l.address).toBeUndefined();
    expect(l.note).toMatch(/placeId/);
  });

  it("persist_ok (OSM) utrwala pełne dane", () => {
    const o = normalizeCandidate(raw({ company: "Bud", email: "b@b.pl", address: "Kraków" }), { source: "osm", now: NOW });
    const l = candidateToLead(o, NOW);
    expect(l.email).toBe("b@b.pl");
    expect(l.address).toBe("Kraków");
  });
});
