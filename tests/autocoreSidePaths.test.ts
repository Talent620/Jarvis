// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { resolveService, reportOutcome } from "../src/lib/autocore/gateway";
import { budgetState, recordCall, resetBudget, setDailyLimit } from "../src/lib/autocore/budget";
import { keyUsable, reportFailure, resetHealth } from "../src/lib/autocore/health";
import { resetRouter } from "../src/lib/autocore/router";
import { routeOrder, askJarvis } from "../src/lib/brain";
import { PROVIDERS, emptyKeys } from "../src/lib/providers/registry";
import { store } from "../src/lib/store";
import { geminiSpeak } from "../src/lib/voice";

const origImpls = Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.impl]));

beforeEach(() => {
  localStorage.clear();
  resetBudget();
  resetHealth();
  resetRouter();
  for (const [k, impl] of Object.entries(origImpls)) {
    PROVIDERS[k as keyof typeof PROVIDERS].impl = impl;
  }
  store.setSettings({
    provider: "auto",
    model: "auto",
    keys: { ...emptyKeys },
    aiMonthlyBudgetUsd: 0,
    voiceMode: "auto",
    ollamaUrl: "",
    webllmEnabled: false,
    modalUrl: "",
    modalVoiceUrl: "",
    elevenLabsApiKey: "",
    openaiTtsApiKey: "",
    fishAudioApiKey: "",
  });
});

describe("AUTOCORE ścieżki poboczne: TTS, Live Vision, Embeddingi i budżet", () => {
  it("TTS: przy błędzie 401 lub wyczerpanym budżecie blokuje chmurowe Gemini (bezpieczny fallback offline) i nalicza czas Modal Voice", async () => {
    store.setSettings({ keys: { ...emptyKeys, gemini: "AIza_test_key" }, voiceMode: "gemini" });
    expect(resolveService("tts").allowed).toBe(true);

    // 401 wyłącza klucz Gemini → resolveService("tts") zwraca allowed=false, geminiSpeak nie wysyła żądania i zwraca false
    reportOutcome("gemini", "gemini-2.5-flash-preview-tts", "AIza_test_key", false, {
      error: Object.assign(new Error("Unauthorized (401)"), { status: 401 }),
    });
    expect(keyUsable("gemini", "AIza_test_key")).toBe(false);
    expect(resolveService("tts").allowed).toBe(false);
    expect(await geminiSpeak("Test offline fallback")).toBe(false);

    // Modal Voice nalicza czas GPU w budżecie przez reportOutcome
    reportOutcome("modal", "modal-voice", "jvllm_test", true, { latencyMs: 3600 });
    expect(budgetState().spentTodayUsd).toBeGreaterThan(0);
  });

  it("Vision (kamera / Live Vision): pomija dostawcę bez wizji i robi failover na kolejnego wizyjnego", async () => {
    // groq (bez wizji w VISION_ROUTABLE) vs gemini (80, wizja) vs openrouter (60, wizja)
    store.setSettings({
      keys: { ...emptyKeys, groq: "gsk_1", gemini: "AIza_1", openrouter: "sk-or-1" },
    });
    const img = { data: "AAAA", mediaType: "image/jpeg" as const };
    const order = routeOrder([{ role: "user", content: "Co widzisz?", image: img }]);
    expect(order.map((o) => o.provider)).toEqual(["gemini", "openrouter"]);

    // Symuluj 429 na Gemini → failover na OpenRouter (wizja)
    PROVIDERS.gemini.impl = async () => { throw new Error("quota exceeded (429)"); };
    PROVIDERS.openrouter.impl = async () => ({ text: "Widzę miernik napięcia.", tools: [] });
    const reply = await askJarvis([{ role: "user", content: "Popatrz na to", image: img }], undefined, undefined, undefined, undefined, { voiceMode: true });
    expect(reply.via).toBe("openrouter");
    expect(reply.fellBack).toBe(true);
    expect(reply.text).toContain("miernik");
  });

  it("Live Vision (WebSocket) i Embeddingi respektują budżet oraz zdrowie AutoCore", () => {
    store.setSettings({ keys: { ...emptyKeys, gemini: "AIza_live" }, aiMonthlyBudgetUsd: 1 });
    setDailyLimit(0.05);
    expect(resolveService("live").allowed).toBe(true);
    expect(resolveService("embed").allowed).toBe(true);

    // Przekroczenie limitu dziennego blokuje płatne/freemium usługi Live i Embed
    recordCall("anthropic", "claude-opus-4-8", { inputTokens: 0, outputTokens: 1000 }, 100);
    expect(budgetState().level).toBe("stop");
    expect(resolveService("live").allowed).toBe(false);
    expect(resolveService("embed").allowed).toBe(false);

    // Zresetuj budżet, zgłoś błąd 403 na kluczu → oba zablokowane przez zdrowie
    resetBudget();
    reportFailure("gemini", "text-embedding-004", "AIza_live", Object.assign(new Error("Forbidden (403)"), { status: 403 }));
    expect(resolveService("embed").allowed).toBe(false);
    expect(resolveService("live").allowed).toBe(false);
  });
});
