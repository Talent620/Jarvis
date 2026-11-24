// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { store } from "../src/lib/store";
import { PROVIDERS, emptyKeys } from "../src/lib/providers/registry";
import { aiRequest, getLastGatewayTask, reportOutcome, resolveService, resolveVoiceEngine } from "../src/lib/autocore/gateway";
import { budgetGateExternal, budgetState, recordCall, resetBudget, setDailyLimit } from "../src/lib/autocore/budget";
import { resetHealth } from "../src/lib/autocore/health";
import { rankForTask, resetRouter, routingLog } from "../src/lib/autocore/router";
import { providerSupportsVision } from "../src/lib/autocore/catalog";
import { hasUsableBrain, routeOrder } from "../src/lib/brain";
import { resolveVoiceMode } from "../src/lib/voice";
import { ensureIndexed, prepareMemoryContext, rememberFact, resetEmbedBackoff } from "../src/lib/memory";

const origImpls = Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.impl]));

describe("Etap 2 P0 · Szczelny AutoCore, Budżet 100%, Jeden Resolver TTS i Odblokowanie Ollamy", () => {
  beforeEach(() => {
    localStorage.clear();
    resetBudget();
    resetHealth();
    resetRouter();
    resetEmbedBackoff();
    for (const [k, impl] of Object.entries(origImpls)) {
      PROVIDERS[k as keyof typeof PROVIDERS].impl = impl;
    }
    store.setSettings({
      provider: "auto",
      model: "auto",
      keys: { ...emptyKeys },
      aiMonthlyBudgetUsd: 0,
      voiceMode: "auto",
      voiceSystemPl: true,
      voicePinned: false,
      geminiTts: false,
      localTts: false,
      ollamaUrl: "",
      ollamaModelVision: "",
      webllmEnabled: false,
      onDeviceOnly: false,
      elevenLabsApiKey: "",
      elevenLabsVoiceId: "",
      openaiTtsApiKey: "",
      fishAudioApiKey: "",
      fishAudioVoiceId: "",
      falApiKey: "",
      tavilyApiKey: "",
      modalUrl: "",
      modalVoiceUrl: "",
    });
  });

  it("registerGatewayExecutor w pełni zachowuje req.task='E_vision' oraz req.prefer w AutoCore", async () => {
    store.setSettings({
      keys: { ...emptyKeys, gemini: "AIza_test", openrouter: "sk-or-test" },
    });
    let usedModel = "";
    PROVIDERS.openrouter.impl = async (p) => {
      usedModel = p.model;
      return { text: '{"found":true,"x":500,"y":500}', tools: [], usage: { inputTokens: 100, outputTokens: 20 } };
    };
    PROVIDERS.gemini.impl = async () => ({ text: "wrong", tools: [] });

    const reply = await aiRequest({
      task: "E_vision",
      system: "vision",
      history: [{ role: "user", content: "znajdź przycisk" }],
      prefer: { provider: "openrouter", model: "google/gemini-2.0-flash-exp:free" },
    });

    expect(getLastGatewayTask()).toBe("E_vision");
    expect(usedModel).toBe("google/gemini-2.0-flash-exp:free");
    expect(reply.via).toBe("openrouter");
    expect(routingLog().some((r) => r.task === "E_vision" && r.to.startsWith("openrouter/"))).toBe(true);
  });

  it("Wszystkie płatne usługi poboczne (ElevenLabs, OpenAI TTS, Fish, Fal.ai, Tavily, Gemini TTS/Image/Embed, Groq STT) respektują budgetGate STOP i naliczają niezerowy koszt (> 0 USD)", () => {
    store.setSettings({
      keys: { ...emptyKeys, gemini: "AIza_1", groq: "gsk_1" },
      elevenLabsApiKey: "el_key",
      elevenLabsVoiceId: "voice_1",
      openaiTtsApiKey: "sk-oa-tts",
      fishAudioApiKey: "fish_k",
      fishAudioVoiceId: "fish_v",
      falApiKey: "fal_k",
      tavilyApiKey: "tvly_k",
      voiceMode: "eleven",
      aiMonthlyBudgetUsd: 1,
    });
    setDailyLimit(0.05);

    // 1) Każda płatna usługa poboczna nalicza > 0 USD (koniec raportowania 0 USD!)
    const before = budgetState().spentTodayUsd;
    reportOutcome("elevenlabs", "eleven_flash_v2_5", "el_key", true, { units: 200 });
    const afterEleven = budgetState().spentTodayUsd;
    expect(afterEleven).toBeGreaterThan(before);

    reportOutcome("openai-tts", "gpt-4o-mini-tts", "sk-oa-tts", true, { units: 200 });
    const afterOpenAi = budgetState().spentTodayUsd;
    expect(afterOpenAi).toBeGreaterThan(afterEleven);

    reportOutcome("fal", "fal-flux-kontext", "fal_k", true, { units: 1 });
    const afterFal = budgetState().spentTodayUsd;
    expect(afterFal).toBeGreaterThan(afterOpenAi);

    reportOutcome("tavily", "advanced", "tvly_k", true, { units: 1 });
    const afterTavily = budgetState().spentTodayUsd;
    expect(afterTavily).toBeGreaterThan(afterFal);

    reportOutcome("gemini", "gemini-2.5-flash-preview-tts", "AIza_1", true, { units: 150 });
    expect(budgetState().spentTodayUsd).toBeGreaterThan(afterTavily);

    // 2) Po przekroczeniu limitu dziennego → TWARDA BLOKADA wszystkich płatnych usług!
    recordCall("anthropic", "claude-opus-4-8", { inputTokens: 0, outputTokens: 1000 }, 100);
    expect(budgetState().level).toBe("stop");
    expect(budgetGateExternal("elevenlabs").allowed).toBe(false);
    expect(budgetGateExternal("openai-tts").allowed).toBe(false);
    expect(budgetGateExternal("fish").allowed).toBe(false);
    expect(budgetGateExternal("fal").allowed).toBe(false);
    expect(budgetGateExternal("tavily").allowed).toBe(false);
    expect(resolveService("tts").allowed).toBe(false);
    expect(resolveService("image").allowed).toBe(false);
    expect(resolveService("search").allowed).toBe(false);
  });

  it("Jeden resolver TTS: resolveVoiceMode, resolveVoiceEngine i resolveService('tts') są w 100% zgodne", () => {
    // 1) voiceSystemPl=true + klucz Gemini → system / native (NIE udaje gemini!)
    store.setSettings({ keys: { ...emptyKeys, gemini: "AIza_1" }, voiceMode: "auto", voiceSystemPl: true, geminiTts: true });
    expect(resolveVoiceMode(store.settings)).toBe("system");
    expect(resolveVoiceEngine(store.settings)).toBe("system");
    expect(resolveService("tts").provider).toBe("native");

    // 2) ElevenLabs z kluczem ale BEZ elevenLabsVoiceId w trybie eleven → allowed=false (koniec zielonej lampki bez voiceId)
    store.setSettings({ voiceMode: "eleven", elevenLabsApiKey: "el_key", elevenLabsVoiceId: "" });
    expect(resolveVoiceMode(store.settings)).toBe("eleven");
    expect(resolveService("tts").allowed).toBe(false);

    // 3) Po podaniu voiceId → allowed=true
    store.setSettings({ elevenLabsVoiceId: "voice_pl" });
    expect(resolveService("tts").provider).toBe("elevenlabs");
    expect(resolveService("tts").allowed).toBe(true);
  });

  it("Ollama w pełni odblokowana: hasUsableBrain w trybie auto, dynamiczne visionRouting dla lokalnych modeli VL oraz embeddingi Ollamy bez zatrzasku embedDisabled", async () => {
    store.setSettings({
      provider: "auto",
      model: "auto",
      keys: { ...emptyKeys },
      ollamaUrl: "http://127.0.0.1:11434",
      ollamaModelVision: "qwen2.5-vl:7b",
    });

    // 1) LiveOverlay / hasUsableBrain widzi Ollamę w trybie auto
    expect(hasUsableBrain()).toBe(true);

    // 2) Dynamiczne visionRouting dla lokalnych modeli VL
    expect(providerSupportsVision("ollama", "llava:7b")).toBe(true);
    expect(providerSupportsVision("ollama", "qwen2.5-vl:7b")).toBe(true);
    expect(providerSupportsVision("ollama", "minicpm-v")).toBe(true);
    expect(providerSupportsVision("ollama", "llama3.2-vision")).toBe(true);
    expect(providerSupportsVision("ollama", "llama3.1:8b")).toBe(false);

    const rankedVis = rankForTask([{ provider: "ollama", model: "qwen2.5-vl:7b", rank: 20 }], "E_vision");
    expect(rankedVis.length).toBe(1);
    expect(rankedVis[0].item.model).toBe("qwen2.5-vl:7b");

    const order = routeOrder([{ role: "user", content: "opisz ekran" }], { task: "E_vision" });
    expect(order).toEqual([{ provider: "ollama", model: "qwen2.5-vl:7b" }]);

    // 3) memory.ts nie zatrzaskuje embedDisabled i używa embeddingów Ollamy po konfiguracji
    store.setSettings({ ollamaUrl: "" });
    rememberFact("miasto", "Warszawa");
    await ensureIndexed();
    await prepareMemoryContext("gdzie mieszkam"); // brak źródła — NIE może zatrzasnąć na stałe!

    let ollamaEmbedCalled = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/embed")) {
        ollamaEmbedCalled = true;
        return new Response(JSON.stringify({ embeddings: [[0.5, 0.5, 0.5]] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      store.setSettings({ ollamaUrl: "http://127.0.0.1:11434" });
      await ensureIndexed();
      await prepareMemoryContext("gdzie mieszkam");
      expect(ollamaEmbedCalled).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
