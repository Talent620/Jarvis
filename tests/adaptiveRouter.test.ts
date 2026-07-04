import { describe, it, expect, beforeEach } from "vitest";
import { logRouteDecision, clearRouteLog, getRouterStats, adaptiveConfidenceThreshold, tierOf } from "../src/lib/modelRouter";

beforeEach(() => clearRouteLog());

describe("modelRouter — tierOf", () => {
  it("lokalni → reflex, chmura → cortex", () => {
    expect(tierOf("ollama")).toBe("reflex");
    expect(tierOf("webllm")).toBe("reflex");
    expect(tierOf("anthropic")).toBe("cortex");
    expect(tierOf("groq")).toBe("cortex");
  });
});

describe("modelRouter — getRouterStats", () => {
  it("liczy skuteczność (bez eskalacji) i medianę latencji per kind/tier", () => {
    for (const ms of [100, 200, 300, 400, 500]) {
      logRouteDecision({ provider: "ollama", model: "qwen3:1.7b", kind: "simple", reason: "ok", fellBack: false, latencyMs: ms });
    }
    const s = getRouterStats().find((x) => x.kind === "simple" && x.tier === "reflex")!;
    expect(s.count).toBe(5);
    expect(s.successRate).toBe(1);
    expect(s.medianLatencyMs).toBe(300);
  });

  it("eskalacja/failover liczą się jako porażka trasy", () => {
    logRouteDecision({ provider: "ollama", model: "m", kind: "complex", reason: "ok", fellBack: false });
    logRouteDecision({ provider: "ollama", model: "m", kind: "complex", reason: "esk", fellBack: false, escalated: true });
    logRouteDecision({ provider: "ollama", model: "m", kind: "complex", reason: "fb", fellBack: true });
    const s = getRouterStats().find((x) => x.kind === "complex" && x.tier === "reflex")!;
    expect(s.count).toBe(3);
    expect(s.successRate).toBeCloseTo(1 / 3, 2);
  });
});

describe("modelRouter — adaptiveConfidenceThreshold", () => {
  it("za mało próbek → próg bazowy bez zmian", () => {
    logRouteDecision({ provider: "ollama", model: "m", kind: "simple", reason: "ok", fellBack: false });
    expect(adaptiveConfidenceThreshold("simple", 0.55)).toEqual({ threshold: 0.55 });
  });

  it("refleks wiarygodny (≥85%) → niższy próg + powód", () => {
    for (let i = 0; i < 6; i++) logRouteDecision({ provider: "ollama", model: "m", kind: "simple", reason: "ok", fellBack: false });
    const r = adaptiveConfidenceThreshold("simple", 0.55);
    expect(r.threshold).toBeCloseTo(0.40, 5);
    expect(r.reason).toMatch(/skuteczny/);
  });

  it("refleks słaby (<50%) → wyższy próg + powód", () => {
    logRouteDecision({ provider: "ollama", model: "m", kind: "complex", reason: "ok", fellBack: false });
    for (let i = 0; i < 5; i++) logRouteDecision({ provider: "ollama", model: "m", kind: "complex", reason: "esk", fellBack: false, escalated: true });
    const r = adaptiveConfidenceThreshold("complex", 0.55);
    expect(r.threshold).toBeCloseTo(0.70, 5);
    expect(r.reason).toMatch(/słaby/);
  });
});
