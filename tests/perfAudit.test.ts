import { describe, it, expect } from "vitest";
import { perfArgument, perfVerdict, type Vitals } from "../src/lib/sales/perfAudit";
import { normalizeUrl } from "../src/lib/sales/siteAuditClient";

const V = (over: Partial<Vitals> = {}): Vitals => ({
  scores: { performance: 35, accessibility: 70, seo: 65, bestPractices: 80 },
  lab: { lcpMs: 5800, cls: 0.18, tbtMs: 600, fcpMs: 3000, ttfbMs: 1200 },
  field: { lcpMs: 6100, cls: null, inpMs: 350 },
  ...over,
});

describe("perfArgument — twarde argumenty sprzedażowe z metryk", () => {
  it("słaba strona → konkretne, mierzalne zarzuty (max 5)", () => {
    const a = perfArgument(V());
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a.join(" ")).toMatch(/35\/100/);          // wynik wydajności
    expect(a.join(" ")).toMatch(/6,1 s|5,8 s/);      // LCP w sekundach (pole > lab)
    expect(a.join(" ")).toMatch(/zapyta/i);          // język biznesu
  });

  it("szybka, dobra strona → brak (albo minimum) zarzutów", () => {
    const good = perfArgument(V({
      scores: { performance: 96, accessibility: 95, seo: 92, bestPractices: 95 },
      lab: { lcpMs: 1500, cls: 0.02, tbtMs: 80, fcpMs: 1000, ttfbMs: 300 },
      field: { lcpMs: 1600, cls: null, inpMs: 120 },
    }));
    expect(good.length).toBe(0);
  });

  it("używa pola CrUX (realni użytkownicy) zamiast laboratorium dla LCP", () => {
    const a = perfArgument(V({ field: { lcpMs: 9000, cls: null, inpMs: null }, lab: { lcpMs: 1000, cls: 0.0, tbtMs: 0, fcpMs: 0, ttfbMs: 0 }, scores: { performance: 90, accessibility: 95, seo: 95, bestPractices: 95 } }));
    expect(a.join(" ")).toMatch(/9,0 s/);
  });
});

describe("perfVerdict / normalizeUrl", () => {
  it("ocena wg wyniku wydajności", () => {
    expect(perfVerdict(95).label).toMatch(/szybka/);
    expect(perfVerdict(30).label).toMatch(/wolna/);
    expect(perfVerdict(null).label).toMatch(/brak/);
  });
  it("normalizuje URL do https i przepuszcza istniejący schemat", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("http://x.pl")).toBe("http://x.pl");
    expect(normalizeUrl("  ")).toBe("");
  });
});
