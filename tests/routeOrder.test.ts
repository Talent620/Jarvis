// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { routeOrder } from "../src/lib/brain";
import { store } from "../src/lib/store";

const noKeys = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" };

describe("routeOrder — local-first fallback (Ollama domyka łańcuch)", () => {
  beforeEach(() => {
    store.setSettings({ provider: "auto", model: "auto", keys: { ...noKeys }, ollamaUrl: "" });
  });

  it("bez kluczy i bez Ollamy → pusta kolejka (czytelny błąd wyżej)", () => {
    expect(routeOrder([{ role: "user", content: "hej" }])).toEqual([]);
  });

  it("skonfigurowana Ollama wchodzi jako fallback, nawet bez żadnego klucza", () => {
    store.setSettings({ ollamaUrl: "http://192.168.0.10:11434" });
    const order = routeOrder([{ role: "user", content: "hej" }]);
    expect(order.length).toBe(1);
    expect(order[0].provider).toBe("ollama");
  });

  it("z kluczem chmurowym Ollama jest OSTATNIA (chmura ma pierwszeństwo)", () => {
    store.setSettings({ keys: { ...noKeys, gemini: "AIzaTest" }, ollamaUrl: "http://localhost:11434" });
    const order = routeOrder([{ role: "user", content: "hej" }]);
    expect(order[0].provider).toBe("gemini");
    expect(order[order.length - 1].provider).toBe("ollama");
  });

  it("tryb ręczny: wybrany dostawca pierwszy, Ollama nadal domyka", () => {
    store.setSettings({ provider: "groq", model: "auto", keys: { ...noKeys, groq: "gsk_x", gemini: "AIzaY" }, ollamaUrl: "http://localhost:11434" });
    const order = routeOrder([{ role: "user", content: "hej" }]);
    expect(order[0].provider).toBe("groq");
    expect(order.some((o) => o.provider === "gemini")).toBe(true);
    expect(order[order.length - 1].provider).toBe("ollama");
  });
});

describe("routeOrder — Refleks local-first (Zadanie 3)", () => {
  const setOnline = (v: boolean) => Object.defineProperty(navigator, "onLine", { configurable: true, value: v });
  beforeEach(() => {
    setOnline(true);
    store.setSettings({ provider: "auto", model: "auto", keys: { ...noKeys }, ollamaUrl: "", localFirstSimple: false, onDeviceOnly: false, webllmEnabled: false });
  });
  afterEach(() => setOnline(true));

  it("proste + localFirstSimple + online → Ollama PIERWSZA, chmura jako fallback", () => {
    store.setSettings({ localFirstSimple: true, keys: { ...noKeys, gemini: "AIzaX" }, ollamaUrl: "http://localhost:11434" });
    const order = routeOrder([{ role: "user", content: "hej" }]);
    expect(order[0].provider).toBe("ollama");
    expect(order.some((o) => o.provider === "gemini")).toBe(true);
  });

  it("proste + online + localFirstSimple=false → chmura pierwsza (regresja)", () => {
    store.setSettings({ localFirstSimple: false, keys: { ...noKeys, gemini: "AIzaX" }, ollamaUrl: "http://localhost:11434" });
    const order = routeOrder([{ role: "user", content: "hej" }]);
    expect(order[0].provider).toBe("gemini");
  });

  it("complex → chmura PIERWSZA mimo localFirstSimple (jakość > prywatność)", () => {
    store.setSettings({ localFirstSimple: true, keys: { ...noKeys, gemini: "AIzaX" }, ollamaUrl: "http://localhost:11434" });
    const order = routeOrder([{ role: "user", content: "napisz kod sortujący i zoptymalizuj ten algorytm, przeanalizuj złożoność" }]);
    expect(order[0].provider).toBe("gemini");
  });

  it("offline → model lokalny PIERWSZY niezależnie od localFirstSimple", () => {
    setOnline(false);
    store.setSettings({ localFirstSimple: false, keys: { ...noKeys, gemini: "AIzaX" }, ollamaUrl: "http://localhost:11434" });
    const order = routeOrder([{ role: "user", content: "hej" }]);
    expect(order[0].provider).toBe("ollama");
  });

  it("onDeviceOnly → sam lokalny ogon (regresja — nie zepsuj)", () => {
    store.setSettings({ onDeviceOnly: true, localFirstSimple: true, keys: { ...noKeys, gemini: "AIzaX" }, ollamaUrl: "http://localhost:11434" });
    const order = routeOrder([{ role: "user", content: "hej" }]);
    expect(order.length).toBe(1);
    expect(order[0].provider).toBe("ollama");
  });
});
