// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { routeOrder } from "../src/lib/brain";
import { store } from "../src/lib/store";

const noKeys = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" };

const ollamaModel = (content: string, image?: string) => {
  const msg = { role: "user" as const, content, ...(image ? { image } : {}) };
  return routeOrder([msg]).find((o) => o.provider === "ollama")?.model;
};

describe("brain — pickOllamaModel (wybór modelu per typ zadania)", () => {
  beforeEach(() => {
    store.setSettings({
      provider: "auto", model: "auto", keys: { ...noKeys },
      ollamaUrl: "http://localhost:11434",
      ollamaModelSimple: "", ollamaModelComplex: "", ollamaModelVision: "",
      localFirstSimple: false, onDeviceOnly: false, webllmEnabled: false,
    });
  });

  it("domyślnie — katalog: proste → qwen3:1.7b", () => {
    expect(ollamaModel("hej")).toBe("qwen3:1.7b");
  });

  it("zadanie z obrazem → model wizji z katalogu (gemma3:4b-it-qat)", () => {
    expect(ollamaModel("co to jest?", "data:image/png;base64,AAAA")).toBe("gemma3:4b-it-qat");
  });

  it("nadpisanie per-kind: proste używa ollamaModelSimple", () => {
    store.setSettings({ ollamaModelSimple: "gemma2:2b" });
    expect(ollamaModel("hej")).toBe("gemma2:2b");
  });

  it("nadpisanie wizji: obraz używa ollamaModelVision", () => {
    store.setSettings({ ollamaModelVision: "llava:7b" });
    expect(ollamaModel("opisz", "data:image/png;base64,AAAA")).toBe("llava:7b");
  });

  it("jawny wybór modelu (provider=ollama, konkretny model) ma pierwszeństwo nad nadpisaniami", () => {
    store.setSettings({ provider: "ollama", model: "mistral:7b", ollamaModelSimple: "gemma2:2b" });
    expect(ollamaModel("hej")).toBe("mistral:7b");
  });

  it("puste nadpisanie (spacje) → wraca do katalogu", () => {
    store.setSettings({ ollamaModelSimple: "   " });
    expect(ollamaModel("hej")).toBe("qwen3:1.7b");
  });
});
