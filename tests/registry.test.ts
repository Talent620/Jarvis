import { describe, it, expect } from "vitest";
import { detectProvider, autoPick, isUncensored, FREE_UNCENSORED, injectNoThink, modelBadges, PROVIDERS, providerShortName } from "../src/lib/providers/registry";

describe("Cohere — nowy darmowy dostawca", () => {
  it("jest w katalogu z modelami Command i sensownym domyślnym", () => {
    const c = PROVIDERS.cohere;
    expect(c).toBeTruthy();
    expect(c.defaultModel).toBe("command-a-03-2025");
    expect(c.models.some((m) => m.id === "command-r7b-12-2024")).toBe(true);
    expect(c.keysUrl).toMatch(/cohere\.com/);
  });
  it("auto wybiera Cohere, gdy to jedyny wpisany klucz", () => {
    const r = autoPick({ cohere: "ABC123" });
    expect(r?.provider).toBe("cohere");
    expect(r?.model).toBe("command-a-03-2025");
  });
  it("dostawcy z wyższą rangą wygrywają nad Cohere w auto", () => {
    const r = autoPick({ cohere: "x", gemini: "y" });
    expect(r?.provider).toBe("gemini"); // gemini (80) > cohere (45)
  });
});

describe("providerShortName — etykieta via … pod odpowiedzią", () => {
  it("krótkie, ludzkie nazwy; lokalne wyróżnione; pusty → ''", () => {
    expect(providerShortName("gemini")).toBe("Gemini");
    expect(providerShortName("anthropic")).toBe("Claude");
    expect(providerShortName("cohere")).toBe("Cohere");
    expect(providerShortName("ollama")).toMatch(/lokalny/);
    expect(providerShortName(undefined)).toBe("");
    expect(providerShortName("")).toBe("");
  });
});

describe("modelBadges — czytelne ikonki cech modelu z opisu", () => {
  it("darmowy → 🆓; najszybszy → ⚡; mocny → 🧠", () => {
    expect(modelBadges("Llama 3.3 70B — darmowy")).toContain("🆓");
    expect(modelBadges("Haiku 4.5 — najszybszy")).toContain("⚡");
    expect(modelBadges("Opus 4.8 — maksymalna inteligencja")).toContain("🧠");
  });
  it("wizja → 👁; bez cenzury → 🔓", () => {
    expect(modelBadges("Pixtral 12B — wizja")).toContain("👁");
    expect(modelBadges("Dolphin 3.0 — bez cenzury (free)")).toContain("🔓");
  });
  it("łączy kilka cech (darmowy + szybki) i nie dubluje", () => {
    const b = modelBadges("Gemini 2.5 Flash-Lite — najszybszy, darmowy");
    expect(b).toContain("🆓");
    expect(b).toContain("⚡");
    expect(b.match(/⚡/g)?.length).toBe(1); // tylko jedna ikona szybkości
  });
  it("neutralny opis bez cech → pusty (brak śmieci)", () => {
    expect(modelBadges("Gemini 2.0 Flash")).toBe("");
    expect(modelBadges("")).toBe("");
  });
  it("każdy model w katalogu daje string (bez wyjątków)", () => {
    for (const p of Object.values(PROVIDERS)) for (const m of p.models) expect(typeof modelBadges(m.label)).toBe("string");
  });
});

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
