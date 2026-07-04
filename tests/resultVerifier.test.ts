import { describe, it, expect } from "vitest";
import { verifyResult, needsVerification } from "../src/lib/resultVerifier";
import { confirmed, simulated, attempted, draft, failed } from "../src/lib/actionOutcome";

describe("resultVerifier — verifyResult (sprawdź zanim ogłosisz sukces)", () => {
  it("potwierdzona wysyłka → complete, wysoka pewność", () => {
    const r = verifyResult({ goal: "wyślij ofertę", steps: [{ id: "send", successCriteria: "mail wysłany", outcome: confirmed(), claimedSuccess: true }] });
    expect(r.complete).toBe(true);
    expect(r.unsupportedClaims).toEqual([]);
    expect(r.confidence).toBe(1);
  });

  it("SYMULACJA ogłoszona jako sukces → unsupportedClaim, nie complete", () => {
    const r = verifyResult({ goal: "wyślij", steps: [{ id: "send", successCriteria: "mail wysłany", outcome: simulated(), claimedSuccess: true }] });
    expect(r.complete).toBe(false);
    expect(r.unsupportedClaims.length).toBe(1);
    expect(r.unsupportedClaims[0]).toMatch(/SIMULATED/);
  });

  it("ATTEMPTED/DRAFT też nie liczą się jako sukces", () => {
    expect(verifyResult({ goal: "x", steps: [{ id: "a", outcome: attempted() }] }).complete).toBe(false);
    expect(verifyResult({ goal: "x", steps: [{ id: "a", outcome: draft() }] }).complete).toBe(false);
  });

  it("częściowo wykonany plan → missingSteps wskazuje niepotwierdzone", () => {
    const r = verifyResult({ goal: "lead→kasa", steps: [
      { id: "lead", successCriteria: "lead zapisany", outcome: confirmed() },
      { id: "mail", successCriteria: "mail wysłany", outcome: failed() },
    ] });
    expect(r.complete).toBe(false);
    expect(r.missingSteps).toContain("mail wysłany");
    expect(r.confidence).toBeLessThan(1);
    expect(r.safeFinalSummary).toMatch(/niepotwierdzone/);
  });

  it("sprzeczności obniżają pewność i są w wyniku", () => {
    const r = verifyResult({ goal: "x", steps: [{ id: "a", outcome: confirmed() }], contradictions: ["dwa różne adresy klienta"] });
    expect(r.complete).toBe(false);
    expect(r.contradictions).toContain("dwa różne adresy klienta");
    expect(r.confidence).toBeLessThan(1);
  });
});

describe("resultVerifier — needsVerification (kiedy w ogóle weryfikować)", () => {
  it("zwykła rozmowa / bardzo krótkie → NIE", () => {
    expect(needsVerification({ veryShort: true })).toBe(false);
    expect(needsVerification({ complex: false, usedTools: false })).toBe(false);
  });
  it("plan wieloetapowy / akcja ryzykowna / złożone z narzędziami → TAK", () => {
    expect(needsVerification({ multiStep: true })).toBe(true);
    expect(needsVerification({ riskyAction: true })).toBe(true);
    expect(needsVerification({ complex: true, usedTools: true })).toBe(true);
  });
});
