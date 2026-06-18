// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  priceFor,
  costOf,
  parsePricingOverrides,
  totals,
  within,
  breakdown,
  forecastMonthlyUsd,
  budgetStatus,
  recordUsage,
  loadUsage,
  clearUsage,
  type UsageEntry,
} from "../src/lib/usageTelemetry";

const DAY = 86_400_000;
const mk = (over: Partial<UsageEntry>): UsageEntry => ({
  at: Date.now(),
  provider: "groq",
  model: "meta-llama/llama-4-scout-17b-16e-instruct",
  inputTokens: 1000,
  outputTokens: 500,
  costUsd: 0,
  ...over,
});

describe("usageTelemetry — wycena", () => {
  it("priceFor: domyślny cennik, nadpisania, 0 dla nieznanych", () => {
    expect(priceFor("claude-opus-4-8").in).toBe(15);
    expect(priceFor("nieznany-model")).toEqual({ in: 0, out: 0 });
    expect(priceFor("x", { x: { in: 2, out: 4 } })).toEqual({ in: 2, out: 4 });
  });

  it("costOf liczy USD z tokenów (na 1M)", () => {
    // 1M in @ $15, 1M out @ $75 = 90
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, { in: 15, out: 75 })).toBeCloseTo(90);
  });

  it("parsePricingOverrides: poprawny JSON, odrzuca śmieci", () => {
    expect(parsePricingOverrides('{"m":{"in":1,"out":2}}')).toEqual({ m: { in: 1, out: 2 } });
    expect(parsePricingOverrides("")).toBeUndefined();
    expect(parsePricingOverrides("{niepoprawny}")).toBeUndefined();
    expect(parsePricingOverrides('{"m":{"in":"x"}}')).toBeUndefined();
  });
});

describe("usageTelemetry — agregacje", () => {
  it("totals sumuje wywołania/tokeny/koszt", () => {
    const t = totals([mk({ costUsd: 1 }), mk({ costUsd: 2 })]);
    expect(t).toEqual({ calls: 2, inputTokens: 2000, outputTokens: 1000, costUsd: 3 });
  });

  it("within filtruje po czasie", () => {
    const now = Date.now();
    const entries = [mk({ at: now }), mk({ at: now - 10 * DAY })];
    expect(within(entries, now - 7 * DAY)).toHaveLength(1);
  });

  it("breakdown grupuje wg dostawcy/modelu", () => {
    const b = breakdown([mk({ provider: "groq", costUsd: 1 }), mk({ provider: "anthropic", costUsd: 2 })], "provider");
    expect(b.groq.costUsd).toBe(1);
    expect(b.anthropic.costUsd).toBe(2);
  });

  it("forecastMonthlyUsd ekstrapoluje run-rate 7 dni → 30 dni", () => {
    const now = Date.now();
    // $7 w ostatnim tygodniu → ~$30/mies.
    const entries = Array.from({ length: 7 }, (_, i) => mk({ at: now - i * DAY, costUsd: 1 }));
    expect(forecastMonthlyUsd(entries, now)).toBeCloseTo(30);
  });

  it("budgetStatus: brak limitu, ostrzeżenie ≥80%, przekroczenie ≥100%", () => {
    expect(budgetStatus(50, 0).over).toBe(false); // brak limitu
    expect(budgetStatus(8, 10).warn).toBe(true);
    expect(budgetStatus(8, 10).over).toBe(false);
    expect(budgetStatus(11, 10).over).toBe(true);
  });
});

describe("usageTelemetry — trwałość", () => {
  beforeEach(() => clearUsage());

  it("recordUsage zapisuje i pomija puste (0/0)", () => {
    recordUsage(mk({ costUsd: 1 }));
    recordUsage(mk({ inputTokens: 0, outputTokens: 0, costUsd: 0 }));
    const all = loadUsage();
    expect(all).toHaveLength(1);
    expect(all[0].costUsd).toBe(1);
  });
});
