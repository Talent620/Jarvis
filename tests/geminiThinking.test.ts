import { describe, it, expect } from "vitest";
import { reasoningProfileFor } from "../src/lib/modelRouter";
import { geminiThinkingConfig } from "../src/lib/geminiCapabilities";

describe("modelRouter — reasoningProfileFor (z rodzaju zadania)", () => {
  it("proste → low; bardzo krótkie/nawigacyjne → minimal", () => {
    expect(reasoningProfileFor("simple")).toBe("low");
    expect(reasoningProfileFor("simple", { veryShort: true })).toBe("minimal");
  });
  it("wizja → medium", () => {
    expect(reasoningProfileFor("vision")).toBe("medium");
  });
  it("złożone (analiza/strategia/finanse/kod/plan) → high", () => {
    expect(reasoningProfileFor("complex")).toBe("high");
  });
  it("głębokie myślenie lub ryzykowne działanie → high (nawet dla prostego)", () => {
    expect(reasoningProfileFor("simple", { deepThink: true })).toBe("high");
    expect(reasoningProfileFor("simple", { riskyAction: true })).toBe("high");
  });
});

describe("geminiCapabilities — geminiThinkingConfig (capability-gated)", () => {
  it("Gemini 3 dostaje thinkingLevel", () => {
    expect(geminiThinkingConfig("gemini-3-pro", "high")).toEqual({ thinkingLevel: "high" });
    expect(geminiThinkingConfig("gemini-3-pro", "low")).toEqual({ thinkingLevel: "low" });
    expect(geminiThinkingConfig("gemini-3-pro", "minimal")).toEqual({ thinkingLevel: "low" });
  });
  it("Gemini 2.5 dostaje thinkingBudget (high=dynamiczny -1, minimal=0)", () => {
    expect(geminiThinkingConfig("gemini-2.5-flash", "high")).toEqual({ thinkingBudget: -1 });
    expect(geminiThinkingConfig("gemini-2.5-flash", "medium")).toEqual({ thinkingBudget: 2048 });
    expect(geminiThinkingConfig("gemini-2.5-flash", "low")).toEqual({ thinkingBudget: 512 });
    expect(geminiThinkingConfig("gemini-2.5-flash", "minimal")).toEqual({ thinkingBudget: 0 });
  });
  it("model BEZ myślenia → null (nie wysyłamy nieobsługiwanego pola)", () => {
    expect(geminiThinkingConfig("gemini-2.0-flash", "high")).toBeNull();
    expect(geminiThinkingConfig("gemini-1.5-pro", "high")).toBeNull();
  });
});
