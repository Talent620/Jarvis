import { describe, it, expect, beforeEach } from "vitest";
import { logError, recordLatency, getEvents, reliabilityStats, clearEvents, subscribeLog, type LogEvent } from "../src/lib/errorLog";

beforeEach(() => clearEvents());

describe("errorLog — pierścień zdarzeń", () => {
  it("logError dodaje zdarzenie (najświeższe pierwsze)", () => {
    logError("provider:groq", new Error("rate limit"), "llama");
    logError("provider:gemini", "boom");
    const ev = getEvents();
    expect(ev[0].scope).toBe("provider:gemini");
    expect(ev[1].message).toBe("rate limit");
    expect(ev[1].ctx).toBe("llama");
  });

  it("reliabilityStats liczy błędy per scope, latencję i successRate", () => {
    recordLatency("provider:groq", 100, true);
    recordLatency("provider:groq", 300, true);
    recordLatency("provider:groq", 500, false);
    logError("provider:groq", "x");
    logError("provider:gemini", "y");

    const s = reliabilityStats();
    expect(s.byScope["provider:groq"]).toBe(1);
    expect(s.byScope["provider:gemini"]).toBe(1);
    expect(s.errors).toBe(2);
    expect(s.latencyP50).toBeGreaterThan(0);
    expect(s.successRate).toBeCloseTo(2 / 3, 2); // 2 ok z 3 pomiarów
  });

  it("pierścień jest ograniczony (nie rośnie w nieskończoność)", () => {
    for (let i = 0; i < 400; i++) logError("s", `e${i}`);
    expect(getEvents(1000).length).toBeLessThanOrEqual(300);
  });

  it("subscribeLog dostaje zdarzenia na żywo i odsubskrybowuje", () => {
    const got: LogEvent[] = [];
    const off = subscribeLog((e) => got.push(e));
    logError("provider:groq", "rate limit", "llama");
    expect(got).toHaveLength(1);
    expect(got[0].scope).toBe("provider:groq");
    off();
    logError("provider:gemini", "boom");
    expect(got).toHaveLength(1); // po odsubskrybowaniu — bez nowych
  });

  it("błąd subskrybenta NIE przerywa logowania", () => {
    const off = subscribeLog(() => { throw new Error("zły subskrybent"); });
    expect(() => logError("x", "y")).not.toThrow();
    expect(getEvents()[0].scope).toBe("x");
    off();
  });
});
