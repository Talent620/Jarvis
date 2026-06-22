import { describe, it, expect } from "vitest";
import { valuate, plnRange, type CodeStats } from "../src/lib/projectValue";

const stats = (over: Partial<CodeStats> = {}): CodeStats =>
  ({ modules: 160, components: 58, tests: 164, files: 380, loc: 70000, ...over });

describe("valuate — wycena z metryk kodu", () => {
  it("szybka sprzedaż 'jak jest' jest WYRAŹNIE niższa niż koszt odtworzenia", () => {
    const v = valuate(stats());
    expect(v.quickHighPln).toBeLessThan(v.replMinPln);
    expect(v.quickLowPln).toBeGreaterThan(0);
  });

  it("godziny i miesiące rosną z LOC", () => {
    const small = valuate(stats({ loc: 10000 }));
    const big = valuate(stats({ loc: 100000 }));
    expect(big.hours).toBeGreaterThan(small.hours);
    expect(big.months).toBeGreaterThan(small.months);
  });

  it("trudność mieści się w 1–10 i rośnie z rozmiarem", () => {
    const v = valuate(stats());
    expect(v.difficulty).toBeGreaterThanOrEqual(1);
    expect(v.difficulty).toBeLessThanOrEqual(10);
    expect(valuate(stats({ loc: 120000, modules: 220 })).difficulty)
      .toBeGreaterThanOrEqual(valuate(stats({ loc: 5000, modules: 10 })).difficulty);
  });

  it("zera nie wywalają (dev bez metryk)", () => {
    const v = valuate({ modules: 0, components: 0, tests: 0, files: 0, loc: 0 });
    expect(v.hours).toBe(0);
    expect(v.difficulty).toBeGreaterThanOrEqual(1);
  });

  it("plnRange formatuje po polsku", () => {
    expect(plnRange(15000, 40000)).toMatch(/15[\s ]?000.*–.*40[\s ]?000 zł/);
  });
});
