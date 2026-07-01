// === Wyjaśnialny ICP score (leadScoring) — testy ===
// Każdy wynik jest zrozumiały. Kluczowe: lead bez strony i bez kontaktu NIE wygrywa automatycznie
// z aktywną, dobrze dopasowaną firmą. Wynik ma powody, brakujące dowody i następną akcję.
import { describe, it, expect } from "vitest";
import { scoreLead, signalsFromLead, adjustWeight, resetWeights, DEFAULT_WEIGHTS, type ScoringSignals } from "../src/lib/leadScoring";
import type { Lead } from "../src/types";

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
