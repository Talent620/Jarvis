import { describe, it, expect } from "vitest";
import { pickWorkingBrain } from "../src/lib/selfHeal";

describe("selfHeal — pickWorkingBrain (autonomiczny wybór działającego mózgu)", () => {
  it("Ollama działa + obecny ollama → zostaje, model installed zachowany", () => {
    expect(pickWorkingBrain({ current: { provider: "ollama", model: "qwen3.5:4b" }, ollamaOk: true, installedModels: ["qwen3.5:4b"], cloudKeyProviders: [] }))
      .toEqual({ provider: "ollama", model: "qwen3.5:4b" });
  });

  it("Ollama działa + obecny ollama z modelem NIEzainstalowanym → model=auto", () => {
    expect(pickWorkingBrain({ current: { provider: "ollama", model: "nie-ma" }, ollamaOk: true, installedModels: ["qwen3.5:4b"], cloudKeyProviders: [] }))
      .toEqual({ provider: "ollama", model: "auto" });
  });

  it("ręczny dostawca chmurowy bez klucza → przełącz na działający (ollama)", () => {
    expect(pickWorkingBrain({ current: { provider: "anthropic", model: "auto" }, ollamaOk: true, installedModels: [], cloudKeyProviders: [] }))
      .toEqual({ provider: "ollama", model: "auto" });
  });

  it("ręczny dostawca chmurowy bez klucza, Ollama off, ale jest inny klucz → auto", () => {
    expect(pickWorkingBrain({ current: { provider: "anthropic", model: "auto" }, ollamaOk: false, installedModels: [], cloudKeyProviders: ["gemini"] }))
      .toEqual({ provider: "auto", model: "auto" });
  });

  it("ręczny dostawca chmurowy Z kluczem → zostaje", () => {
    expect(pickWorkingBrain({ current: { provider: "gemini", model: "gemini-2.0" }, ollamaOk: false, installedModels: [], cloudKeyProviders: ["gemini"] }))
      .toEqual({ provider: "gemini", model: "gemini-2.0" });
  });

  it("auto + jest klucz chmurowy → auto", () => {
    expect(pickWorkingBrain({ current: { provider: "auto", model: "auto" }, ollamaOk: false, installedModels: [], cloudKeyProviders: ["groq"] }))
      .toEqual({ provider: "auto", model: "auto" });
  });

  it("nic nie działa (Ollama off, brak kluczy) → null", () => {
    expect(pickWorkingBrain({ current: { provider: "auto", model: "auto" }, ollamaOk: false, installedModels: [], cloudKeyProviders: [] }))
      .toBeNull();
  });
});
