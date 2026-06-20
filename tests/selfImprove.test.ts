import { describe, it, expect } from "vitest";
import { analyzePerformance, type SelfAssessment } from "../src/lib/selfImprove";
import type { RouteLogEntry } from "../src/lib/modelRouter";

const mk = (o: Partial<RouteLogEntry>): RouteLogEntry => ({
  at: 1, provider: "gemini", model: "g", kind: "simple", reason: "", fellBack: false, ...o,
});

describe("selfImprove — metryki", () => {
  it("liczy fallback/eskalacje/latencję/udział lokalny", () => {
    const routes = [
      mk({ provider: "gemini", fellBack: false, latencyMs: 1000 }),
      mk({ provider: "groq", fellBack: true, latencyMs: 3000 }),
      mk({ provider: "ollama", tier: "reflex", fellBack: false, latencyMs: 500, escalated: true }),
      mk({ provider: "ollama", tier: "reflex", fellBack: false, latencyMs: 700 }),
    ];
    const a = analyzePerformance(routes);
    expect(a.metrics.total).toBe(4);
    expect(a.metrics.fallbackRate).toBeCloseTo(0.25, 2);
    expect(a.metrics.localShare).toBeCloseTo(0.5, 2);
    expect(a.metrics.latencyP50).toBeGreaterThan(0);
  });
});

describe("selfImprove — wnioski (Learn)", () => {
  it("wysoki fallback → wniosek o zawodnym mózgu (high)", () => {
    const routes = Array.from({ length: 10 }, (_, i) => mk({ fellBack: i < 5 })); // 50%
    const a = analyzePerformance(routes);
    expect(a.insights.some((x) => x.severity === "high" && /zawodzi|fallback|zapasow/i.test(x.title + x.detail))).toBe(true);
  });
  it("wysoka latencja p95 → sugestia trybu szybkiego (action faster)", () => {
    const routes = Array.from({ length: 10 }, () => mk({ latencyMs: 12000 }));
    const a = analyzePerformance(routes);
    expect(a.insights.some((x) => x.action === "faster")).toBe(true);
  });
  it("refleks często eskaluje → sugestia mocniejszego modelu (action smarter)", () => {
    const routes = Array.from({ length: 10 }, () => mk({ provider: "ollama", tier: "reflex", escalated: true }));
    const a = analyzePerformance(routes);
    expect(a.insights.some((x) => x.action === "smarter")).toBe(true);
  });
  it("błędy dostawcy chmury + dostępny lokalny → sugestia lokalnego (goLocal)", () => {
    const routes = Array.from({ length: 10 }, () => mk({ provider: "gemini" }));
    const a = analyzePerformance(routes, { "provider:gemini": 6 }, Date.now(), { ollamaReady: true });
    expect(a.insights.some((x) => x.action === "goLocal")).toBe(true);
  });
  it("za mało danych → informacja, bez fałszywych alarmów", () => {
    const a: SelfAssessment = analyzePerformance([mk({})]);
    expect(a.insights.every((x) => x.severity !== "high")).toBe(true);
  });
});
