// === Wyjaśnialny ICP score (leadScoring) — testy ===
// Każdy wynik jest zrozumiały. Kluczowe: lead bez strony i bez kontaktu NIE wygrywa automatycznie
// z aktywną, dobrze dopasowaną firmą. Wynik ma powody, brakujące dowody i następną akcję.
import { describe, it, expect } from "vitest";
import { scoreLead, signalsFromLead, signalsFromCandidate, learnWeightsFromOutcome, adjustWeight, resetWeights, DEFAULT_WEIGHTS, type ScoringSignals } from "../src/lib/leadScoring";
import type { Lead } from "../src/types";
import type { LeadCandidate } from "../src/lib/leadCandidates";

const candidate = (over: Partial<LeadCandidate>): LeadCandidate => ({
  id: "C", company: "Firma", source: "osm", fetchedAt: NOW, confidence: 0.6,
  evidence: [], persistencePolicy: "persist_ok", contactability: "none",
  qualityWarnings: [], isSample: false, ...over,
});

const NOW = 11_000_000_000;
const DAY = 86_400_000;
const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "X", status: "new", createdAt: NOW, updatedAt: NOW, ...over });

const strong: ScoringSignals = { offerFit: 0.8, companyActivity: 0.8, needSignal: 0.4, potentialValue: 0.8, contactCompleteness: 1, sourceCredibility: 0.9, freshness: 0.9, competition: 0.3, risk: 0.2 };
const noSiteNoContact: ScoringSignals = { offerFit: 0.4, companyActivity: 0.2, needSignal: 0.7, potentialValue: 0.4, contactCompleteness: 0, sourceCredibility: 0.7, freshness: 0.5, competition: 0.4, risk: 0.2 };

describe("leadScoring — zrozumiały wynik", () => {
  it("zwraca 0–100, pewność, do 3 powodów i następną akcję", () => {
    const r = scoreLead(strong);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.topReasons.length).toBeLessThanOrEqual(3);
    expect(["research", "call", "demo", "offer", "reject"]).toContain(r.bestNextAction);
  });

  it("brak strony to JEDEN sygnał — lead bez kontaktu nie wygrywa z aktywną, dopasowaną firmą", () => {
    const a = scoreLead(strong);
    const b = scoreLead(noSiteNoContact);
    expect(a.score).toBeGreaterThan(b.score); // aktywna firma z kontaktem wygrywa
    expect(b.bestNextAction).toBe("research"); // bez kontaktu — najpierw research, nie oferta
    expect(b.missingEvidence.join(" ")).toMatch(/kontakt/i);
  });

  it("bardzo słaby lead → reject", () => {
    const weak: ScoringSignals = { offerFit: 0.1, companyActivity: 0.1, needSignal: 0.2, potentialValue: 0.1, contactCompleteness: 0, sourceCredibility: 0.3, freshness: 0.1, competition: 0.8, risk: 0.8 };
    expect(scoreLead(weak).bestNextAction).toBe("reject");
  });

  it("wyraźna potrzeba + dopasowanie + kontakt → demo", () => {
    const r = scoreLead({ ...strong, needSignal: 0.8, offerFit: 0.6 });
    expect(["demo", "offer"]).toContain(r.bestNextAction);
  });
});

describe("leadScoring — sygnały z leada", () => {
  it("brak strony podnosi needSignal, ale brak kontaktu obniża completeness", () => {
    const s = signalsFromLead(lead({ url: undefined, email: undefined, contact: undefined }), NOW);
    expect(s.needSignal).toBeGreaterThanOrEqual(0.7);
    expect(s.contactCompleteness).toBe(0);
  });

  it("firma ze stroną, e-mailem i świeżym kontaktem → wyższa aktywność i kontakt", () => {
    const s = signalsFromLead(lead({ url: "https://x.pl", email: "a@x.pl", hours: "9-17", lastContactedAt: NOW - DAY, followUpCount: 1 }), NOW);
    expect(s.contactCompleteness).toBeGreaterThan(0.5);
    expect(s.companyActivity).toBeGreaterThan(0.6);
  });
});

describe("leadScoring — sygnały z kandydata (provenance + contact policy)", () => {
  it("kandydat przykładowy (mock) ma wysokie ryzyko i przegrywa z realnym z e-mailem", () => {
    const real = scoreLead(signalsFromCandidate(candidate({ source: "google_places", contactability: "email", url: "https://x.pl", niche: "fryzjer" }), NOW));
    const sample = scoreLead(signalsFromCandidate(candidate({ source: "mock", isSample: true, contactability: "email" }), NOW));
    expect(real.score).toBeGreaterThan(sample.score);
    expect(signalsFromCandidate(candidate({ isSample: true }), NOW).risk).toBeGreaterThan(0.6);
  });

  it("kontaktowalność przekłada się na kompletność kontaktu; brak strony podnosi needSignal", () => {
    expect(signalsFromCandidate(candidate({ contactability: "email" }), NOW).contactCompleteness).toBe(1);
    expect(signalsFromCandidate(candidate({ contactability: "phone" }), NOW).contactCompleteness).toBe(0.6);
    expect(signalsFromCandidate(candidate({ url: undefined }), NOW).needSignal).toBeGreaterThan(0.6);
    expect(signalsFromCandidate(candidate({ url: "https://x.pl" }), NOW).needSignal).toBeLessThan(0.5);
  });

  it("provenance liczy się: Google Places wiarygodniejsze niż mock", () => {
    expect(signalsFromCandidate(candidate({ source: "google_places" }), NOW).sourceCredibility)
      .toBeGreaterThan(signalsFromCandidate(candidate({ source: "mock" }), NOW).sourceCredibility);
  });
});

describe("leadScoring — uczenie tylko z potwierdzonych wyników", () => {
  it("wygrana nudguje najmocniejsze sygnały w górę, granice bezpieczne", () => {
    const learned = learnWeightsFromOutcome({ ...DEFAULT_WEIGHTS }, strong, true);
    // Najmocniejszy dodatni wkład (offerFit/potentialValue) powinien urosnąć.
    const grew = (Object.keys(DEFAULT_WEIGHTS) as (keyof typeof DEFAULT_WEIGHTS)[]).some((k) => learned[k] > DEFAULT_WEIGHTS[k]);
    expect(grew).toBe(true);
    expect(learned.contactCompleteness).toBeLessThanOrEqual(DEFAULT_WEIGHTS.contactCompleteness * 2);
  });

  it("przegrana obniża wagi tych samych sygnałów (bezpieczna dolna granica)", () => {
    const learned = learnWeightsFromOutcome({ ...DEFAULT_WEIGHTS }, strong, false);
    const shrank = (Object.keys(DEFAULT_WEIGHTS) as (keyof typeof DEFAULT_WEIGHTS)[]).some((k) => learned[k] < DEFAULT_WEIGHTS[k]);
    expect(shrank).toBe(true);
  });
});

describe("leadScoring — douczanie wag (bezpieczne granice + reset)", () => {
  it("waga rośnie po wygranej i nie przekracza granicy 2x; reset przywraca domyślne", () => {
    let w = { ...DEFAULT_WEIGHTS };
    for (let i = 0; i < 50; i++) w = adjustWeight(w, "offerFit", true);
    expect(w.offerFit).toBeLessThanOrEqual(DEFAULT_WEIGHTS.offerFit * 2);
    expect(w.offerFit).toBeGreaterThan(DEFAULT_WEIGHTS.offerFit);
    w = resetWeights();
    expect(w.offerFit).toBe(DEFAULT_WEIGHTS.offerFit);
  });
});
