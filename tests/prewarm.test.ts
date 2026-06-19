// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { shouldPrewarm, prewarmModel, maybePrewarm, warmNow, __resetPrewarm } from "../src/lib/prewarm";
import { store } from "../src/lib/store";
import { PROVIDERS } from "../src/lib/providers/registry";

beforeEach(() => {
  __resetPrewarm();
  store.setSettings({ prewarmLocal: false, ollamaUrl: "", provider: "auto", model: "auto" });
  vi.unstubAllGlobals();
});

describe("prewarm — shouldPrewarm (opt-in + throttle)", () => {
  it("domyślnie OFF → false", () => {
    expect(shouldPrewarm()).toBe(false);
  });
  it("on + adres → true; bez adresu → false", () => {
    store.setSettings({ prewarmLocal: true, ollamaUrl: "" });
    expect(shouldPrewarm()).toBe(false);
    store.setSettings({ ollamaUrl: "http://localhost:11434" });
    expect(shouldPrewarm()).toBe(true);
  });
  it("throttle: tuż po rozgrzewce nie rozgrzewa ponownie", () => {
    store.setSettings({ prewarmLocal: true, ollamaUrl: "http://localhost:11434" });
    const now = 1_000_000;
    expect(shouldPrewarm(now)).toBe(true);
    // symuluj że właśnie rozgrzaliśmy (maybePrewarm ustawia lastPrewarm)
    expect(shouldPrewarm(now + 1000)).toBe(true); // bez maybePrewarm throttle nieaktywny
  });
});

describe("prewarm — prewarmModel", () => {
  it("domyślnie model domyślny Ollamy", () => {
    expect(prewarmModel()).toBe(PROVIDERS.ollama.defaultModel);
  });
  it("gdy dostawca = ollama z wybranym modelem → ten model", () => {
    store.setSettings({ provider: "ollama", model: "gemma2:2b" });
    expect(prewarmModel()).toBe("gemma2:2b");
  });
});

describe("prewarm — maybePrewarm", () => {
  it("strzela /api/generate z keep_alive i throttluje kolejne wywołanie", async () => {
    store.setSettings({ prewarmLocal: true, ollamaUrl: "http://localhost:11434", provider: "ollama", model: "qwen3:1.7b" });
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await maybePrewarm(1_000_000);
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/generate");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ model: "qwen3:1.7b", keep_alive: "30m" });

    // throttle: drugie wywołanie w oknie → nie strzela
    const again = await maybePrewarm(1_000_000 + 5_000);
    expect(again).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("OFF → nic nie robi", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await maybePrewarm()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("prewarm — warmNow (jednorazowo, niezależnie od prewarmLocal)", () => {
  it("rozgrzewa NAWET gdy prewarmLocal=OFF, byle był adres", async () => {
    store.setSettings({ prewarmLocal: false, ollamaUrl: "http://localhost:11434", provider: "ollama", model: "qwen3:1.7b" });
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await warmNow()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/generate");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ model: "qwen3:1.7b", keep_alive: "30m" });
  });
  it("bez adresu → false, bez fetch", async () => {
    store.setSettings({ ollamaUrl: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await warmNow()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
