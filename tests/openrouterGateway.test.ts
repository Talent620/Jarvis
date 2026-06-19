import { describe, it, expect, beforeEach } from "vitest";
import { routeOrder } from "../src/lib/brain";
import { PROVIDERS } from "../src/lib/providers/registry";
import { store } from "../src/lib/store";

// Faza E — OpenRouter jako brama failover (35+ modeli) i źródło salda/kosztów.
const noKeys = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" };

beforeEach(() => {
  store.setSettings({
    provider: "auto", model: "auto",
    onDeviceOnly: false, webllmEnabled: false, ollamaUrl: "",
    keys: { ...noKeys },
  });
});

describe("OpenRouter — brama failover", () => {
  it("jest w katalogu z konfiguracją bramy (online suffix + nagłówki)", () => {
    expect(PROVIDERS.openrouter).toBeDefined();
    expect(typeof PROVIDERS.openrouter.impl).toBe("function");
    expect(PROVIDERS.openrouter.models.length).toBeGreaterThan(3);
  });

  it("z kluczem OpenRouter wchodzi do łańcucha prób", () => {
    store.setSettings({ keys: { ...noKeys, openrouter: "sk-or-v1-test" } });
    const order = routeOrder([{ role: "user", content: "cześć" }]);
    expect(order.some((o) => o.provider === "openrouter")).toBe(true);
  });

  it("służy jako FAILOVER za dostawcą wyższej rangi (Anthropic → OpenRouter)", () => {
    store.setSettings({ keys: { ...noKeys, anthropic: "sk-ant-test", openrouter: "sk-or-v1-test" } });
    const order = routeOrder([{ role: "user", content: "cześć" }]);
    const ai = order.findIndex((o) => o.provider === "anthropic");
    const oi = order.findIndex((o) => o.provider === "openrouter");
    expect(ai).toBeGreaterThanOrEqual(0);
    expect(oi).toBeGreaterThan(ai); // OpenRouter po Anthropic = zapas
  });
});
