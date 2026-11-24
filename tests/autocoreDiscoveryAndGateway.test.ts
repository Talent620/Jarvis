// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  connectService, mergeProviderKey, parseModelsPayload, migrateExistingConfig, resetDiscovery, discoveredModelsFor,
} from "../src/lib/autocore/discovery";
import { aiRequest, resolveService, registerGatewayExecutor } from "../src/lib/autocore/gateway";
import {
  runBenchmark, evaluatePromotion, resetExperiments, BENCHMARK_CASES,
} from "../src/lib/autocore/experiments";
import { resetBudget, budgetState, authorizeService } from "../src/lib/autocore/budget";
import { resetHealth, reportFailure } from "../src/lib/autocore/health";
import { resetRouter, promotionFor } from "../src/lib/autocore/router";
import { store } from "../src/lib/store";
import { emptyKeys } from "../src/lib/providers/registry";

beforeEach(() => {
  localStorage.clear();
  resetDiscovery();
  resetBudget();
  resetHealth();
  resetRouter();
  resetExperiments();
  store.setSettings({
    keys: { ...emptyKeys },
    proxyUrl: "",
    modalUrl: "",
    aiMonthlyBudgetUsd: 0,
    voiceMode: "auto",
  });
});

describe("AUTOCORE discovery + Magic Paste", () => {
  it("scala klucze bez nadpisywania i bez duplikatów", () => {
    const r1 = mergeProviderKey("old-key", "new-key");
    expect(r1).toEqual({ merged: "new-key\nold-key", added: true });
    const r2 = mergeProviderKey(r1.merged, "old-key");
    expect(r2.added).toBe(false);
    expect(r2.merged).toBe("new-key\nold-key");
  });

  it("parsuje OpenRouter /models z modalnościami i ceną 0 jako verifiedFree", () => {
    const parsed = parseModelsPayload("openrouter", {
      data: [
        { id: "meta-llama/llama-3.3-70b-instruct:free", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"] }, supported_parameters: ["tools"] },
        { id: "openai/gpt-4o", pricing: { prompt: "0.000005", completion: "0.000015" }, architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["tools"] },
      ],
    });
    expect(parsed.verifiedFreeIds).toEqual(["meta-llama/llama-3.3-70b-instruct:free"]);
    expect(parsed.models[1].capabilities).toContain("vision");
    expect(parsed.models[1].capLevel).toBe("declared");
  });

  it("connectService wykrywa klucz bez prefiksu (np. Mistral) przez prawdziwy endpoint, scala i oznacza płatny jako oczekujący", async () => {
    store.setSettings({ keys: { ...emptyKeys, mistral: "prev-key" } });
    const fakeFetch: typeof fetch = async (url) => {
      if (String(url).includes("api.mistral.ai/v1/models")) {
        return new Response(JSON.stringify({
          data: [{ id: "mistral-small-latest", capabilities: { vision: false, function_calling: true } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("unauthorized", { status: 401 });
    };

    const res = await connectService("plain_mistral_key_no_prefix", { fetchFn: fakeFetch });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("mistral");
    expect(res.addedKey).toBe(true);
    expect(res.pendingBudgetApproval).toBe(true);
    expect(res.discovery?.functionalVerified).toBe(false);
    expect(store.settings.keys.mistral).toBe("plain_mistral_key_no_prefix\nprev-key");
    expect(discoveredModelsFor("mistral").map((m) => m.id)).toEqual(["mistral-small-latest"]);
    expect(budgetState().pending).toContain("mistral");
    // Zatwierdzenie limitu odblokowuje usługę
    expect(authorizeService("mistral", 5).ok).toBe(true);
    expect(budgetState().pending).not.toContain("mistral");
  });

  it("migrateExistingConfig nie blokuje wcześniej skonfigurowanych kluczy", () => {
    store.setSettings({ keys: { ...emptyKeys, groq: "gsk_existing" } });
    const m = migrateExistingConfig();
    expect(m.migratedProviders).toEqual(["groq"]);
    expect(budgetState().pending).toEqual([]);
  });
});

describe("AUTOCORE AI Gateway", () => {
  it("aiRequest deleguje do zarejestrowanego wykonawcy z automatyczną klasą zadania", async () => {
    let seenTask = "";
    registerGatewayExecutor(async (req) => {
      seenTask = req.task || "";
      return { text: "OK", tools: [] };
    });
    const r = await aiRequest({ system: "s", history: [{ role: "user", content: "napisz kod typescript" }] });
    expect(r.text).toBe("OK");
    expect(seenTask).toBe("C_coding");
  });

  it("resolveService respektuje zdrowie i brak klucza", () => {
    store.setSettings({ keys: { ...emptyKeys, groq: "gsk_bad" } });
    expect(resolveService("stt").allowed).toBe(true);
    reportFailure("groq", "whisper-large-v3-turbo", "gsk_bad", new Error("Unauthorized (401)"));
    const blocked = resolveService("stt");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("zablokowany");
  });
});

describe("AUTOCORE experiments", () => {
  it("domyślnie pomija płatne modele; lokalne testuje i promuje tylko przy wyraźnej przewadze bez regresji", async () => {
    const skipped = await runBenchmark("anthropic", "claude-opus-4-8", async () => ({ text: "", latencyMs: 10 }));
    expect(skipped.skipped).toContain("Pominięto");

    const perfectRunner = async (_p: unknown, _m: unknown, prompt: string) => ({
      text: prompt.includes("JSON") ? '{"ok":true,"count":3}' : prompt.includes("17 * 24") ? "408" : "timer_set",
      latencyMs: 50,
    });
    // 2 przebiegi kandydata (ollama) dla C_coding
    const codingCase = [BENCHMARK_CASES[0]];
    await runBenchmark("ollama", "qwen3.5:4b", perfectRunner, { cases: codingCase });
    await runBenchmark("ollama", "qwen3.5:4b", perfectRunner, { cases: codingCase });

    const promo = evaluatePromotion("C_coding", { provider: "ollama", model: "qwen3.5:4b" }, { provider: "groq", model: "kimi-k2" }, { apply: true });
    expect(promo.promoted).toBe(true);
    expect(promotionFor("C_coding")?.model).toBe("qwen3.5:4b");
  });
});
