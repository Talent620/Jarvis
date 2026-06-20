import { describe, it, expect } from "vitest";
import { detectProvider, autoPick, isUncensored, FREE_UNCENSORED, injectNoThink } from "../src/lib/providers/registry";

describe("injectNoThink — /no_think tylko dla modeli rozumujących", () => {
  const h = [{ role: "user" as const, content: "cześć" }];
  it("qwen3 / deepseek → dopina /no_think do ostatniej wiadomości użytkownika", () => {
    expect(injectNoThink(h, "qwen3:4b")[0].content).toMatch(/\/no_think$/);
    expect(injectNoThink(h, "deepseek-r1:7b")[0].content).toMatch(/\/no_think$/);
  });
  it("gemma / llama → bez zmian (ten sam obiekt, brak zbędnego tokenu)", () => {
    expect(injectNoThink(h, "gemma3:4b")).toBe(h);
    expect(injectNoThink(h, "llama3.1:8b")).toBe(h);
  });
  it("dopina do OSTATNIEJ wiadomości użytkownika, nie asystenta", () => {
    const conv = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
      { role: "user" as const, content: "c" },
    ];
    const out = injectNoThink(conv, "qwen3:4b");
    expect(out[2].content).toMatch(/\/no_think$/);
    expect(out[0].content).toBe("a");
  });
});

describe("detectProvider (rozpoznawanie klucza po formacie)", () => {
  it("rozpoznaje znane formaty kluczy", () => {
    expect(detectProvider("sk-ant-api03-abc")).toBe("anthropic");
    expect(detectProvider("sk-or-v1-abc")).toBe("openrouter");
    expect(detectProvider("gsk_abc")).toBe("groq");
    expect(detectProvider("nvapi-abc")).toBe("nvidia");
    expect(detectProvider("AIzaSyAbc123")).toBe("gemini");
    expect(detectProvider("ghp_abc")).toBe("github");
    expect(detectProvider("github_pat_abc")).toBe("github");
  });
  it("zwraca null dla nieznanego/pustego", () => {
    expect(detectProvider("")).toBeNull();
    expect(detectProvider("losowy-ciag-123")).toBeNull();
  });
  it("nie myli OpenRoutera z Anthropic", () => {
    expect(detectProvider("sk-or-v1-xyz")).toBe("openrouter");
    expect(detectProvider("sk-ant-xyz")).toBe("anthropic");
  });
});

describe("autoPick (wybór dostawcy wg rangi)", () => {
  it("wybiera dostawcę o najwyższej randze z kluczem", () => {
    expect(autoPick({ groq: "x", anthropic: "y" })?.provider).toBe("anthropic");
    expect(autoPick({ groq: "x", gemini: "y" })?.provider).toBe("gemini");
  });
  it("zwraca null bez kluczy", () => {
    expect(autoPick({})).toBeNull();
  });
});

describe("modele nieocenzurowane", () => {
  it("rozpoznaje modele uncensored (chmura i lokalne)", () => {
    expect(isUncensored("cognitivecomputations/dolphin3.0-mistral-24b:free")).toBe(true);
    expect(isUncensored("dolphin-mistral")).toBe(true);
    expect(isUncensored("llama2-uncensored")).toBe(true);
  });
  it("zwykłe modele nie są oznaczone jako uncensored", () => {
    expect(isUncensored("gemini-2.5-flash")).toBe(false);
    expect(isUncensored("claude-opus-4-8")).toBe(false);
  });
  it("preset darmowego czatu bez cenzury wskazuje istniejący model", () => {
    expect(FREE_UNCENSORED.provider).toBe("openrouter");
    expect(isUncensored(FREE_UNCENSORED.model)).toBe(true);
  });
});
