// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { pickLocalModel, diagnoseOllamaError, findOllamaServer } from "../src/lib/privateMode";
import { store } from "../src/lib/store";

describe("Tryb Prywatny — wybór modelu lokalnego", () => {
  it("preferuje model bez cenzury (dolphin), gdy dostępny", () => {
    expect(pickLocalModel(["llama3.2:latest", "dolphin-mistral:latest", "qwen2.5"])).toMatch(/dolphin/);
  });
  it("bierze pierwszy dostępny, gdy brak uncensored", () => {
    expect(pickLocalModel(["llama3.2:latest", "qwen2.5"])).toBe("llama3.2:latest");
  });
  it("zwraca null, gdy brak modeli", () => {
    expect(pickLocalModel([])).toBeNull();
  });
});

describe("diagnoseOllamaError — czytelna diagnoza zamiast 'failed to fetch'", () => {
  it("strona HTTPS + adres http:// → mixed-content z konkretną radą", () => {
    const m = diagnoseOllamaError("http://192.168.0.10:11434", new TypeError("Failed to fetch"), true);
    expect(m).toMatch(/Mieszana zawartość|HTTPS/i);
    expect(m).toMatch(/APK|tailscale/i);
  });
  it("timeout/abort → komunikat o braku odpowiedzi i sieci", () => {
    const e = new Error("The operation was aborted"); e.name = "AbortError";
    expect(diagnoseOllamaError("http://localhost:11434", e, false)).toMatch(/nie odpowiedział|sieci/i);
  });
  it("zwykły failed to fetch (http) → wskazuje CORS / adres / serwer + .exe", () => {
    const m = diagnoseOllamaError("http://localhost:11434", new TypeError("Failed to fetch"), false);
    expect(m).toMatch(/CORS|OLLAMA_ORIGINS/);
    expect(m).toMatch(/JARVIS-Ollama-Server\.exe/);
  });
  it("nieznany błąd → przekazuje treść", () => {
    expect(diagnoseOllamaError("http://x:11434", new Error("coś dziwnego"), false)).toBe("coś dziwnego");
  });
});

describe("findOllamaServer — auto-znajdowanie serwera", () => {
  beforeEach(() => { store.setSettings({ ollamaUrl: "" }); vi.unstubAllGlobals(); });

  it("znajduje pierwszy odpowiadający (localhost) i zwraca modele", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("localhost")) return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
      throw new TypeError("Failed to fetch");
    }));
    const r = await findOllamaServer();
    expect(r.ok).toBe(true);
    expect(r.url).toBe("http://localhost:11434");
    expect(r.models).toEqual(["qwen3.5:4b"]);
  });

  it("żaden nie odpowiada → ok:false z czytelną radą", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const r = await findOllamaServer(["http://localhost:11434"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JARVIS-Ollama-Server\.exe|adres recznie|ręcznie/);
    expect(r.tried).toContain("http://localhost:11434");
  });

  it("dedupuje kandydatów", async () => {
    const f = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", f);
    const r = await findOllamaServer(["http://localhost:11434", "http://localhost:11434"]);
    expect(r.tried).toEqual(["http://localhost:11434"]);
  });
});
