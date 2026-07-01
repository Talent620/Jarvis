// === Kolejka kandydatów (leadCandidates) — testy ===
// Samo wyszukanie NIE zmienia CRM; import zapisuje tylko zaznaczonych. Dane przykładowe są
// oznaczone jako przykład. Wszystkie źródła mają ten sam kontrakt kandydata.
import { describe, it, expect } from "vitest";
import { discoverLeadCandidates, normalizeCandidate, candidateToLead, importCandidates } from "../src/lib/leadCandidates";
import type { RawLead } from "../src/lib/leads";
import type { Lead } from "../src/types";

const NOW = 10_000_000;
const raw = (over: Partial<RawLead>): RawLead => ({ company: "Firma", hasWebsite: false, ...over });

describe("leadCandidates — odkrywanie bez zapisu", () => {
  it("mapuje surowe wyniki na kandydatów, sortuje po pewności, dedupuje", () => {
    const cands = discoverLeadCandidates([
      raw({ company: "Alfa", email: "a@alfa.pl", website: "https://alfa.pl", address: "Kraków" }),
      raw({ company: "Beta" }),
      raw({ company: "Alfa", email: "a@alfa.pl" }), // duplikat po kluczu
    ], { source: "osm", now: NOW });
    expect(cands.length).toBe(2);           // duplikat odrzucony
    expect(cands[0].company).toBe("Alfa");  // wyższa pewność na górze
    expect(cands[0].confidence).toBeGreaterThan(cands[1].confidence);
  });

  it("kandydat ma źródło, czas, dowody, kontaktowalność i politykę przechowywania", () => {
    const c = normalizeCandidate(raw({ company: "Alfa", email: "a@alfa.pl", website: "https://alfa.pl" }), { source: "google_places", now: NOW, sourceId: "PLACE1" });
    expect(c.source).toBe("google_places");
    expect(c.persistencePolicy).toBe("id_only"); // Google: trwale tylko placeId
    expect(c.contactability).toBe("email");
    expect(c.fetchedAt).toBe(NOW);
    expect(c.sourceId).toBe("PLACE1");
  });
});

describe("leadCandidates — dane przykładowe (MOCK) widoczne jako przykład", () => {
  it("mock → isSample, niska pewność, ostrzeżenie i polityka no_persist", () => {
    const c = normalizeCandidate(raw({ company: "Przykład Sp. z o.o.", email: "x@x.pl" }), { source: "mock", now: NOW, isSample: true });
    expect(c.isSample).toBe(true);
    expect(c.persistencePolicy).toBe("no_persist");
    expect(c.qualityWarnings.join(" ")).toMatch(/PRZYKŁADOWE/i);
    expect(c.confidence).toBeLessThanOrEqual(0.2);
  });

  it("import przykładu oznacza go w notatce", () => {
    const c = normalizeCandidate(raw({ company: "Przykład" }), { source: "mock", now: NOW, isSample: true });
    expect(candidateToLead(c, NOW).note).toMatch(/PRZYKŁAD/);
  });
});

describe("leadCandidates — import zapisuje TYLKO zaznaczonych", () => {
  it("samo odkrycie nie tworzy leadów; import dodaje tylko wybranych (dedup)", () => {
    const cands = discoverLeadCandidates([raw({ company: "Alfa", email: "a@alfa.pl" }), raw({ company: "Beta", phone: "600100200" })], { source: "osm", now: NOW });
    const existing: Lead[] = [];
    // Importujemy TYLKO pierwszego zaznaczonego.
    const added = importCandidates(existing, [cands[0]], { now: NOW, makeId: (c) => `L-${c.id}` });
    expect(added).toHaveLength(1);
    expect(added[0].company).toBe(cands[0].company);
  });

  it("nie duplikuje istniejącego leada przy imporcie", () => {
    const c = normalizeCandidate(raw({ company: "Alfa", email: "a@alfa.pl" }), { source: "osm", now: NOW });
    const existing: Lead[] = [{ id: "x", company: "Alfa", status: "new", createdAt: 1, updatedAt: 1 }];
    expect(importCandidates(existing, [c], { now: NOW, makeId: () => "new" })).toHaveLength(0);
  });

  it("mock (no_persist) NIGDY nie wchodzi do CRM, nawet zaznaczony", () => {
    const mock = normalizeCandidate(raw({ company: "Przykład Sp. z o.o.", email: "x@x.pl" }), { source: "mock", now: NOW, isSample: true });
    expect(mock.persistencePolicy).toBe("no_persist");
    expect(importCandidates([], [mock], { now: NOW, makeId: () => "m" })).toHaveLength(0);
  });
});
