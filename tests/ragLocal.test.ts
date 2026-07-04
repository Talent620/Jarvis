// @vitest-environment jsdom
// Zadanie 11 — RAG dla modelu lokalnego: TEN SAM blok pamięci (fakty + profil), który
// trafia do chmury, ma trafiać do wywołania lokalnego (Ollama/WebLLM). Dowodzimy, że
// `askJarvis` wstrzykuje pamięć do system-promptu modelu lokalnego — bez zależności sieciowych.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { askJarvis } from "../src/lib/brain";
import { PROVIDERS } from "../src/lib/providers/registry";
import { store } from "../src/lib/store";
import { rememberFact } from "../src/lib/memory";

const noKeys = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" };

describe("RAG dla modelu lokalnego (Z11)", () => {
  beforeEach(() => {
    store.setData((d) => { d.memory = []; });
    store.setSettings({
      provider: "ollama", model: "auto", keys: { ...noKeys }, ollamaUrl: "http://localhost:11434",
      onDeviceOnly: false, localFirstSimple: false, speculativeMode: false, confidenceGate: false,
      memoryServiceUrl: "", memoryServiceToken: "",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("blok pamięci (fakt) trafia do system-promptu wywołania lokalnego", async () => {
    rememberFact("ulubiony_jezyk", "TypeScript");
    let captured = "";
    const spy = vi.spyOn(PROVIDERS.ollama, "impl").mockImplementation(async (ctx) => {
      captured = ctx.system;
      return { text: "ok", tools: [] };
    });
    await askJarvis([{ role: "user", content: "co lubię?" }]);
    expect(spy).toHaveBeenCalled();
    expect(captured).toContain("Zapamiętane fakty"); // nagłówek bloku pamięci
    expect(captured).toContain("TypeScript"); // konkretny fakt użytkownika
  });

  it("działa bez Mem0 (degradacja do lokalnego profilu — zero zależności sieciowych)", async () => {
    store.setSettings({ userName: "Sir" });
    let captured = "";
    const spy = vi.spyOn(PROVIDERS.ollama, "impl").mockImplementation(async (ctx) => {
      captured = ctx.system;
      return { text: "ok", tools: [] };
    });
    await askJarvis([{ role: "user", content: "przywitaj się" }]);
    expect(spy).toHaveBeenCalled();
    // System prompt zbudowany lokalnie (persona + profil) mimo braku memoryServiceUrl.
    expect(captured).toContain("JARVIS");
    expect(captured.length).toBeGreaterThan(100);
  });
});
