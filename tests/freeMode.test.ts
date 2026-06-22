import { describe, it, expect } from "vitest";
import { isFreeProvider, freeOnly, FREE_PROVIDERS, FREE_STACK } from "../src/lib/freeMode";
import { bestFreeBrain, type LeagueInput } from "../src/lib/league";
import type { IqResult } from "../src/lib/iqProbe";

describe("freeMode — darmowi vs płatni dostawcy", () => {
  it("Anthropic (Claude) NIE jest darmowy; reszta z tieru — tak", () => {
    expect(isFreeProvider("anthropic")).toBe(false);
    for (const p of ["gemini", "groq", "cerebras", "mistral", "cohere", "openrouter", "nvidia", "ollama", "webllm"] as const) {
      expect(isFreeProvider(p)).toBe(true);
    }
  });

  it("freeOnly odcina płatnego Claude'a z łańcucha", () => {
    const order = [
      { provider: "anthropic" as const, model: "claude-opus-4-8" },
      { provider: "gemini" as const, model: "gemini-2.5-flash" },
      { provider: "groq" as const, model: "kimi" },
    ];
    expect(freeOnly(order).map((o) => o.provider)).toEqual(["gemini", "groq"]);
  });

  it("rekomendowany darmowy zestaw to sami darmowi dostawcy", () => {
    for (const f of FREE_STACK) expect(FREE_PROVIDERS.has(f.provider)).toBe(true);
  });
});

describe("bestFreeBrain — najlepszy gotowy darmowy mózg", () => {
  const inputs: LeagueInput[] = [
    { provider: "anthropic", model: "claude-opus-4-8", label: "Claude", ready: true },
    { provider: "gemini", model: "gemini-2.5-flash", label: "Gemini", ready: true },
    { provider: "groq", model: "llama-3.1-8b-instant", label: "Groq", ready: true },
  ];
  const res = (pct: number): IqResult => ({ correct: 0, total: 6, pct, ms: 1000, at: 0 });

  it("nigdy nie wybiera płatnego Claude'a — nawet gdy najmocniejszy", () => {
    const b = bestFreeBrain(inputs, {});
    expect(b).not.toBeNull();
    expect(b!.provider).not.toBe("anthropic");
  });

  it("wśród darmowych szanuje pomiar (zmierzony wygrywa)", () => {
    const b = bestFreeBrain(inputs, { "groq:llama-3.1-8b-instant": res(100) });
    expect(b!.provider).toBe("groq");
  });
});
