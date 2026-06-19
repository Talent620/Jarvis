import { describe, it, expect, beforeEach } from "vitest";
import { relTime, describeRoute, recentRoutes } from "../src/lib/routeView";
import { logRouteDecision, clearRouteLog, type RouteLogEntry } from "../src/lib/modelRouter";

const NOW = 1_700_000_000_000;

beforeEach(() => {
  clearRouteLog();
});

describe("routeView — relTime", () => {
  it("sekundy", () => {
    expect(relTime(NOW - 12_000, NOW)).toBe("12s temu");
  });
  it("minuty", () => {
    expect(relTime(NOW - 3 * 60_000, NOW)).toBe("3 min temu");
  });
  it("godziny", () => {
    expect(relTime(NOW - 2 * 3_600_000, NOW)).toBe("2 h temu");
  });
  it("dni", () => {
    expect(relTime(NOW - 2 * 86_400_000, NOW)).toBe("2 dni temu");
  });
  it("przyszłość/clamp → 0s", () => {
    expect(relTime(NOW + 5_000, NOW)).toBe("0s temu");
  });
});

function entry(p: Partial<RouteLogEntry>): RouteLogEntry {
  return {
    at: NOW,
    provider: "ollama",
    model: "qwen3:1.7b",
    kind: "simple",
    reason: "test",
    fellBack: false,
    ...p,
  } as RouteLogEntry;
}

describe("routeView — describeRoute", () => {
  it("refleks ok → 🟢, tłumaczy kind/tier na polski", () => {
    const line = describeRoute(entry({ provider: "ollama", kind: "simple" }), NOW);
    expect(line.badge).toBe("🟢");
    expect(line.kind).toBe("proste");
    expect(line.tier).toBe("Refleks (lokalny)");
    expect(line.outcome).toBe("ok");
  });

  it("kora bez eskalacji → 🧠", () => {
    const line = describeRoute(entry({ provider: "anthropic", kind: "complex" }), NOW);
    expect(line.badge).toBe("🧠");
    expect(line.tier).toBe("Kora (chmura)");
    expect(line.kind).toBe("złożone");
  });

  it("eskalacja → 🟡 i outcome eskalacja→Kora", () => {
    const line = describeRoute(entry({ provider: "ollama", escalated: true, localConfidence: 0.41, latencyMs: 820 }), NOW);
    expect(line.badge).toBe("🟡");
    expect(line.outcome).toBe("eskalacja→Kora");
    expect(line.meta).toContain("~820 ms");
    expect(line.meta).toContain("pewność 41%");
  });

  it("failover → 🟡 i outcome fallback", () => {
    const line = describeRoute(entry({ provider: "groq", fellBack: true }), NOW);
    expect(line.badge).toBe("🟡");
    expect(line.outcome).toBe("fallback");
  });

  it("brak latencji/pewności → pusty meta", () => {
    const line = describeRoute(entry({ provider: "ollama" }), NOW);
    expect(line.meta).toBe("");
  });
});

describe("routeView — recentRoutes", () => {
  it("zwraca najnowsze pierwsze i respektuje limit", () => {
    logRouteDecision({ provider: "ollama", model: "m", kind: "simple", reason: "a", fellBack: false });
    logRouteDecision({ provider: "anthropic", model: "m", kind: "complex", reason: "b", fellBack: false });
    logRouteDecision({ provider: "groq", model: "m", kind: "simple", reason: "c", fellBack: false });
    const lines = recentRoutes(2, NOW);
    expect(lines).toHaveLength(2);
    // najnowszy (groq) pierwszy
    expect(lines[0].provider).toBe("groq");
    expect(lines[1].provider).toBe("anthropic");
  });

  it("pusty dziennik → pusta lista", () => {
    expect(recentRoutes(10, NOW)).toEqual([]);
  });
});
