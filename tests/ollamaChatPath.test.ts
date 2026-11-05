// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { askJarvis } from "../src/lib/brain";
import { store } from "../src/lib/store";

const old = { ...store.settings };
afterEach(() => { vi.unstubAllGlobals(); store.setSettings(old); });

describe("Ollama — pełna ścieżka czatu", () => {
  it("proste powitanie trafia do lokalnego API bez ogromnego zestawu schematów", async () => {
    store.setSettings({ provider: "ollama", model: "qwen3:4b-instruct-2507-q4_K_M", ollamaUrl: "http://localhost:11434", onDeviceOnly: true, deepThink: false, expertKnowledge: false, interpreterMode: false, webSearch: false, confidenceGate: false, speculativeMode: false, memoryServiceUrl: "" });
    const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).endsWith("/api/chat")) throw new Error("Unexpected network request");
      const body = JSON.parse(String(init?.body));
      expect(body.tools).toBeUndefined();
      expect(body.messages.some((m: { role: string; content: string }) => m.role === "user" && m.content.includes("przedstaw swoje możliwości"))).toBe(true);
      return new Response(JSON.stringify({ message: { role: "assistant", content: "Jestem JARVIS." }, prompt_eval_count: 25, eval_count: 5 }));
    });
    vi.stubGlobal("fetch", mock);
    const result = await askJarvis([{ role: "user", content: "Cześć JARVIS, przedstaw swoje możliwości." }]);
    expect(result.text).toBe("Jestem JARVIS.");
    expect(result.via).toBe("ollama");
    expect(mock).toHaveBeenCalled();
  });
  it("nie przekazuje zapytania do chmury, gdy wybrano Ollamę", async () => {
    store.setSettings({ provider: "ollama", model: "qwen3:4b", ollamaUrl: "http://localhost:11434", onDeviceOnly: false, deepThink: false, interpreterMode: false, webSearch: false, confidenceGate: false, speculativeMode: false, memoryServiceUrl: "", keys: { ...store.settings.keys, gemini: "test-key" } });
    const mock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("http://localhost:11434/api/chat");
      return new Response(JSON.stringify({ message: { role: "assistant", content: "Cześć." } }));
    });
    vi.stubGlobal("fetch", mock);
    const result = await askJarvis([{ role: "user", content: "Cześć" }], undefined, undefined, undefined, { provider: "gemini", model: "gemini-2.5-flash" });
    expect(result.via).toBe("ollama");
    expect(mock).toHaveBeenCalled();
  });
  it("tryb on-device kieruje czat lokalnie mimo chmurowej konfiguracji", async () => {
    store.setSettings({ provider: "gemini", model: "gemini-2.5-flash", ollamaUrl: "http://localhost:11434", onDeviceOnly: true, deepThink: true, interpreterMode: false, webSearch: false, confidenceGate: false, speculativeMode: false, memoryServiceUrl: "", keys: { ...store.settings.keys, gemini: "test-key" } });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      if (!String(url).startsWith("http://localhost:11434/")) throw new Error("Unexpected remote call");
      return new Response(JSON.stringify({ message: { role: "assistant", content: "Wynik lokalny." } }));
    }));
    const result = await askJarvis([{ role: "user", content: "przeanalizuj algorytm" }], undefined, undefined, undefined, { provider: "gemini", model: "gemini-2.5-flash" });
    expect(result.via).toBe("ollama");
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every(url => url.startsWith("http://localhost:11434/"))).toBe(true);
  });

});
