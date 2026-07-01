// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { askJarvis, routeOrder, hasUsableBrain } from "../src/lib/brain";
import { PROVIDERS } from "../src/lib/providers/registry";
import type { ProviderId } from "../src/lib/providers/types";
import { store } from "../src/lib/store";

// Failover „nigdy nie zabraknie": rotacja kluczy + przełączenie na zapasowego
// dostawcę, a w odpowiedzi widać KTO odpowiedział (via) i czy to był zapas (fellBack).

const noKeys = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" };
const orig: Record<string, any> = {};
const reply = (via: string) => ({ text: `OK-${via}`, tools: [] as string[] });

beforeEach(() => {
  for (const id of Object.keys(PROVIDERS)) orig[id] = (PROVIDERS as any)[id].impl;
  store.setSettings({
    provider: "auto", model: "auto", keys: { ...noKeys },
    deepThink: false, interpreterMode: false, expertKnowledge: false,
    webSearch: false, councilMode: false, ollamaUrl: "",
  });
});
afterEach(() => { for (const id of Object.keys(PROVIDERS)) (PROVIDERS as any)[id].impl = orig[id]; });

const setImpl = (id: ProviderId, fn: (apiKey: string) => Promise<any>) => {
  (PROVIDERS as any)[id].impl = (ctx: any) => fn(ctx.apiKey);
};

describe("askJarvis — failover widoczny (via/fellBack)", () => {
  it("główny dostawca w limicie → odpowiada zapasowy; fellBack=true, via=zapas", async () => {
    store.setSettings({ keys: { ...noKeys, gemini: "G1", groq: "GR1" } }); // gemini(80) > groq(70)
    setImpl("gemini", async () => { throw new Error("429 quota exceeded for metric"); });
    setImpl("groq", async () => reply("groq"));
    const r = await askJarvis([{ role: "user", content: "hej" }]);
    expect(r.text).toBe("OK-groq");
    expect(r.fellBack).toBe(true);
    expect(r.via).toBe("groq");
    // Powód failoveru to REALNY, znany błąd głównego dostawcy (humanize) — nie zgadywanie "był zajęty".
    expect(r.fellBackReason).toMatch(/limit|środk/i);
  });

  it("nieznany/nietypowy błąd głównego dostawcy → surowy komunikat do użytkownika, NIGDY zmyślona przyczyna", async () => {
    // Celowa polityka silnika (shouldFallback): nieznany błąd NIE przełącza po cichu na zapas —
    // najpewniej powtórzyłby się u każdego dostawcy (np. zepsute żądanie), a maskowanie go
    // odebrałoby użytkownikowi realną informację. Uczciwość = surowy komunikat, bez "był zajęty".
    store.setSettings({ keys: { ...noKeys, gemini: "G3", groq: "GR3" } });
    setImpl("gemini", async () => { throw new Error("Coś dziwnego i nieoczekiwanego padło"); });
    setImpl("groq", async () => reply("groq"));
    await expect(askJarvis([{ role: "user", content: "hej" }])).rejects.toThrow(/dziwnego i nieoczekiwanego/);
  });

  it("znany błąd główego dostawcy (np. przeciążenie 503) → failover z REALNYM powodem, nie zgadywanym", async () => {
    store.setSettings({ keys: { ...noKeys, gemini: "G4", groq: "GR4" } });
    setImpl("gemini", async () => { throw new Error("503 service unavailable / overloaded"); });
    setImpl("groq", async () => reply("groq"));
    const r = await askJarvis([{ role: "user", content: "hej" }]);
    expect(r.fellBack).toBe(true);
    expect(r.via).toBe("groq");
    // humanize() nie zna tego wzorca → przekazuje SUROWY komunikat błędu — nigdy nie zgaduje "był zajęty".
    expect(r.fellBackReason).toMatch(/unavailable|overloaded/i);
    expect(r.fellBackReason).not.toMatch(/zajęty/i);
  });

  it("główny działa → bez fallbacku; fellBack=false, via=główny", async () => {
    store.setSettings({ keys: { ...noKeys, gemini: "G2", groq: "GR2" } });
    setImpl("gemini", async () => reply("gemini"));
    setImpl("groq", async () => { throw new Error("nie powinno być wołane"); });
    const r = await askJarvis([{ role: "user", content: "hej" }]);
    expect(r.text).toBe("OK-gemini");
    expect(r.fellBack).toBe(false);
    expect(r.via).toBe("gemini");
  });

  it("rotacja kluczy: 1. klucz w limicie → 2. klucz tego samego dostawcy (fellBack=false)", async () => {
    store.setSettings({ keys: { ...noKeys, gemini: "KA\nKB" } });
    setImpl("gemini", async (apiKey) => {
      if (apiKey === "KA") throw new Error("rate limit exceeded (429)");
      return reply("gemini");
    });
    const r = await askJarvis([{ role: "user", content: "hej" }]);
    expect(r.text).toBe("OK-gemini");
    expect(r.fellBack).toBe(false); // ten sam dostawca, inny klucz
  });

  it("wszyscy w limicie → czytelny błąd (humanize), nie surowy", async () => {
    store.setSettings({ keys: { ...noKeys, gemini: "GX", groq: "GRX" } });
    setImpl("gemini", async () => { throw new Error("429 quota exceeded"); });
    setImpl("groq", async () => { throw new Error("429 quota exceeded"); });
    await expect(askJarvis([{ role: "user", content: "hej" }])).rejects.toThrow(/limit|dostawc|środk/i);
  });
});

describe("routeOrder — łańcuch dostawców", () => {
  beforeEach(() => store.setSettings({ provider: "auto", model: "auto", keys: { ...noKeys }, ollamaUrl: "" }));

  it("auto: dostawcy z kluczem wg rangi (gemini przed groq)", () => {
    store.setSettings({ keys: { ...noKeys, gemini: "g", groq: "k" } });
    const order = routeOrder([{ role: "user", content: "x" }]);
    expect(order[0].provider).toBe("gemini");
    expect(order.some((o) => o.provider === "groq")).toBe(true);
  });

  it("Ollama domyka łańcuch jako ostatnia, gdy ustawiona", () => {
    store.setSettings({ keys: { ...noKeys, groq: "k" }, ollamaUrl: "http://localhost:11434" });
    const order = routeOrder([{ role: "user", content: "x" }]);
    expect(order[order.length - 1].provider).toBe("ollama");
  });

  it("ręczny dostawca bez klucza nie wywala (null-safe) — zwraca dostępne mózgi", () => {
    store.setSettings({ provider: "anthropic", model: "auto", keys: { ...noKeys, groq: "k" } });
    const order = routeOrder([{ role: "user", content: "x" }]);
    expect(Array.isArray(order)).toBe(true);
    expect(order.some((o) => o.provider === "groq")).toBe(true);
  });
});

describe("hasUsableBrain — czy jest jakikolwiek mózg", () => {
  beforeEach(() => store.setSettings({ provider: "auto", model: "auto", keys: { ...noKeys }, ollamaUrl: "", webllmEnabled: false }));

  it("brak kluczy i Ollamy → false (wymusza konfigurację)", () => {
    expect(hasUsableBrain()).toBe(false);
  });
  it("tryb auto + sama Ollama (bez kluczy) → true (nie nękaj konfiguracją)", () => {
    store.setSettings({ provider: "auto", ollamaUrl: "http://localhost:11434" });
    expect(hasUsableBrain()).toBe(true);
  });
  it("klucz chmury → true", () => {
    store.setSettings({ keys: { ...noKeys, gemini: "g" } });
    expect(hasUsableBrain()).toBe(true);
  });
});
