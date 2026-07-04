import { describe, it, expect } from "vitest";
import {
  canClaimSuccess, isTerminal, outcomeLabel, outcomeIcon,
  draft, simulated, attempted, confirmed, failed, legacyOutcome,
  type ActionOutcome,
} from "../src/lib/actionOutcome";

describe("actionOutcome — kontrakt prawdy działania", () => {
  it("tylko CONFIRMED wolno przedstawić jako sukces", () => {
    expect(canClaimSuccess(confirmed())).toBe(true);
    expect(canClaimSuccess(draft())).toBe(false);
    expect(canClaimSuccess(simulated())).toBe(false);
    expect(canClaimSuccess(attempted())).toBe(false);
    expect(canClaimSuccess(failed())).toBe(false);
    expect(canClaimSuccess(null)).toBe(false);
  });

  it("SIMULATED i ATTEMPTED NIGDY nie są sukcesem", () => {
    for (const o of [simulated("demo"), attempted("smtp")]) {
      expect(canClaimSuccess(o)).toBe(false);
      expect(outcomeLabel(o)).not.toMatch(/Potwierdzone/);
    }
  });

  it("isTerminal: tylko CONFIRMED/FAILED", () => {
    expect(isTerminal(confirmed())).toBe(true);
    expect(isTerminal(failed())).toBe(true);
    expect(isTerminal(draft())).toBe(false);
    expect(isTerminal(attempted())).toBe(false);
  });

  it("etykiety i ikony są bezpieczne i spójne", () => {
    expect(outcomeLabel(simulated())).toMatch(/Symulacja/);
    expect(outcomeLabel(confirmed({ manual: true }))).toMatch(/ręcznie/);
    expect(outcomeIcon(confirmed())).toBe("✅");
    expect(outcomeIcon(failed())).toBe("❌");
    expect(outcomeIcon(attempted())).toBe("⏳");
    expect(outcomeIcon(simulated())).toBe("🧪");
    expect(outcomeIcon(undefined)).toBe("✍");
  });

  it("legacyOutcome: boolean", () => {
    expect(legacyOutcome(true, 100).state).toBe("CONFIRMED");
    expect(legacyOutcome(true, 100).evidence?.confirmedAt).toBe(100);
    expect(legacyOutcome(false, 100).state).toBe("FAILED");
    expect(legacyOutcome(null, 100).state).toBe("DRAFT");
  });

  it("legacyOutcome: obiekt { ok, via, error, simulated }", () => {
    expect(legacyOutcome({ ok: true, via: "SMTP", providerId: "msg-1" }, 5)).toEqual<ActionOutcome>({
      state: "CONFIRMED", evidence: { confirmedAt: 5, source: "SMTP", providerId: "msg-1" },
    });
    expect(legacyOutcome({ ok: false, error: "timeout", via: "gmail" }, 5).state).toBe("FAILED");
    expect(legacyOutcome({ simulated: true }, 5).state).toBe("SIMULATED");
    // symulacja z ok:true i tak NIE jest wysyłką
    expect(canClaimSuccess(legacyOutcome({ ok: true, simulated: true }, 5))).toBe(false);
  });

  it("legacyOutcome obsługuje pole sent zamiast ok", () => {
    expect(legacyOutcome({ sent: true }, 1).state).toBe("CONFIRMED");
    expect(legacyOutcome({ sent: false }, 1).state).toBe("FAILED");
  });
});
