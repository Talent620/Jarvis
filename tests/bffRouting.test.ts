// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askJarvis, askModel, hasUsableBrain, resolveProvider, routeOrder } from "../src/lib/brain";
import { store } from "../src/lib/store";
import type { ProviderId } from "../src/lib/providers/types";

vi.mock("../src/lib/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/http")>(),
  appTokenHeader: () => ({ "x-app-token": "application-token" }),
}));

const previous = { ...store.settings, keys: { ...store.settings.keys } };
const emptyKeys = Object.fromEntries(Object.keys(store.settings.keys).map((key) => [key, ""]));
const proxyUrl = "https://jarvis-bff.example";
const history = [{ role: "user" as const, content: "Hej" }];

function responseFor(provider: ProviderId, text = "Odpowiedź testowa") {
  if (provider === "anthropic") return Response.json({ content: [{ type: "text", text }] });
  if (provider === "gemini") return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  if (provider === "ollama") return Response.json({ message: { role: "assistant", content: text } });
  return Response.json({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] });
}

beforeEach(() => {
  store.setSettings({
    ...previous, provider: "auto", model: "auto", keys: { ...emptyKeys }, proxyUrl,
    ollamaUrl: "", onDeviceOnly: false, webllmEnabled: false,
    deepThink: false, verifyHard: false, interpreterMode: false,
    expertKnowledge: false, councilMode: false, webSearch: false,
    speculativeMode: false, localFirstSimple: false, localRefine: false,
    localConsensus: false, confidenceGate: false, freeMode: false,
    memoryServiceUrl: "", localEmbeddings: false, aiMonthlyBudgetUsd: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  store.setSettings(previous);
});

describe("BFF server credentials through the real HTTP adapters", () => {
  it.each(["anthropic", "gemini", "groq"] as const)("calls %s without a client API key or placeholder auth header", async (provider) => {
    store.setSettings({ provider });
    const fetcher = vi.fn(async () => responseFor(provider));
    vi.stubGlobal("fetch", fetcher);

    await expect(askModel({ system: "test", history })).resolves.toBe("Odpowiedź testowa");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).origin).toBe(proxyUrl);
    expect(new URL(url).pathname).toBe(provider === "groq" ? "/openai" : `/${provider}`);
    const headers = new Headers(request.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-api-key")).toBe(false);
    expect(headers.get("x-app-token")).toBe("application-token");
    expect(request.method).toBe("POST");
  });

  it("runs the main conversation with server credentials and reports the provider", async () => {
    store.setSettings({ provider: "gemini" });
    const fetcher = vi.fn(async () => responseFor("gemini"));
    vi.stubGlobal("fetch", fetcher);

    await expect(askJarvis(history)).resolves.toMatchObject({ text: "Odpowiedź testowa", via: "gemini", fellBack: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("falls through missing server secrets, including the legacy Gemini HTTP 400 response", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/anthropic") return Response.json({ error: { message: "invalid authentication" } }, { status: 401 });
      if (path === "/gemini") return Response.json({ error: "Brak modelu lub GEMINI_API_KEY." }, { status: 400 });
      expect(new URL(new URL(url).searchParams.get("u")!).host).toBe("api.groq.com");
      return responseFor("groq", "Działa serwerowy Groq");
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(askJarvis(history)).resolves.toMatchObject({ text: "Działa serwerowy Groq", via: "groq", fellBack: true, fellBackReasonKind: "auth" });
    expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/anthropic", "/gemini", "/openai"]);
  });

  it("does not infer server secrets for providers unsupported by the bundled BFF", () => {
    const providers = routeOrder(history).map((route) => route.provider);
    expect(providers).toEqual(["anthropic", "gemini", "groq", "openrouter", "nvidia", "github"]);
  });

  it("retains direct client-key authentication when no proxy is configured", async () => {
    store.setSettings({ provider: "groq", proxyUrl: "", keys: { ...emptyKeys, groq: "browser-client-key" } });
    const fetcher = vi.fn(async () => responseFor("groq"));
    vi.stubGlobal("fetch", fetcher);

    await expect(askModel({ system: "test", history })).resolves.toBe("Odpowiedź testowa");
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).hostname).toBe("api.groq.com");
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer browser-client-key");
    expect(new Headers(request.headers).has("x-app-token")).toBe(false);
  });

  it("rejects empty configuration without making HTTP requests", async () => {
    store.setSettings({ proxyUrl: "  " });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(hasUsableBrain()).toBe(false);
    await expect(askModel({ system: "test", history })).rejects.toThrow("Brak skonfigurowanego modelu AI");
    await expect(askJarvis(history)).rejects.toThrow("Brak skonfigurowanego modelu AI");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["auto", "gemini"] as const)("uses configured Ollama in %s mode without any cloud account", async (provider) => {
    store.setSettings({ provider, proxyUrl: "", ollamaUrl: "http://localhost:11434" });
    const fetcher = vi.fn(async () => responseFor("ollama"));
    vi.stubGlobal("fetch", fetcher);

    await expect(askJarvis(history)).resolves.toMatchObject({ text: "Odpowiedź testowa", via: "ollama" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("http://localhost:11434/api/chat");
  });

  it("requires an Ollama address when a local provider is selected", async () => {
    store.setSettings({ provider: "ollama", proxyUrl: "" });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(hasUsableBrain()).toBe(false);
    await expect(askJarvis(history)).rejects.toThrow("Brak skonfigurowanego modelu AI");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("on-device routing cannot escape through a BFF", () => {
  it("rejects cloud-only configuration even when the BFF and client keys exist", async () => {
    store.setSettings({ onDeviceOnly: true, keys: { ...emptyKeys, gemini: "browser-client-key" } });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(hasUsableBrain()).toBe(false);
    expect(resolveProvider()).toBeNull();
    await expect(askModel({ system: "test", history })).rejects.toThrow("Brak skonfigurowanego modelu AI");
    await expect(askJarvis(history)).rejects.toThrow("Tryb on-device");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps deep reasoning and preferred-provider routing on the local model", async () => {
    store.setSettings({ provider: "gemini", onDeviceOnly: true, ollamaUrl: "http://localhost:11434", deepThink: true, keys: { ...emptyKeys, gemini: "browser-client-key" } });
    const fetcher = vi.fn(async () => responseFor("ollama"));
    vi.stubGlobal("fetch", fetcher);

    expect(resolveProvider()?.provider).toBe("ollama");
    await expect(askJarvis(
      [{ role: "user", content: "Zaprojektuj algorytm sortowania" }],
      undefined, undefined, undefined, { provider: "gemini", model: "gemini-2.5-flash" },
    )).resolves.toMatchObject({ via: "ollama", text: "Odpowiedź testowa" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url] of fetcher.mock.calls as unknown as [string][]) {
      expect(url).toBe("http://localhost:11434/api/chat");
    }
  });

  it("does not fall back to server credentials when the local model fails", async () => {
    store.setSettings({ onDeviceOnly: true, ollamaUrl: "http://localhost:11434" });
    const fetcher = vi.fn(async () => Response.json({ error: "model unavailable (503)" }, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(askModel({ system: "test", history })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("http://localhost:11434/api/chat");
  });
});
