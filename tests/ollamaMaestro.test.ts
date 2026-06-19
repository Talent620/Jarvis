// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/lib/privateMode", () => ({ detectOllama: vi.fn() }));
vi.mock("../src/lib/ollamaPull", () => ({ pullOllamaModel: vi.fn() }));

import { recommendedOverrides, requiredModels, missingModels, applyPremiumSetup, ensurePremiumModels, PREMIUM_CATALOG } from "../src/lib/ollamaMaestro";
import { detectOllama } from "../src/lib/privateMode";
import { pullOllamaModel } from "../src/lib/ollamaPull";
import { store } from "../src/lib/store";

beforeEach(() => {
  vi.clearAllMocks();
  store.setSettings({
    ollamaUrl: "http://localhost:11434", provider: "auto", model: "auto",
    ollamaModelSimple: "", ollamaModelComplex: "", ollamaModelVision: "", ollamaModelUncensored: "",
    localFirstSimple: false, confidenceGate: false, prewarmLocal: false, adaptiveRouter: false, unfilteredLocal: false,
  });
});

describe("ollamaMaestro — rekomendacje (czyste)", () => {
  it("przypisuje modele do ról z katalogu", () => {
    const o = recommendedOverrides();
    expect(o.simple).toBe("qwen3:1.7b");
    expect(o.complex).toBe("qwen3.5:4b");
    expect(o.vision).toBe("gemma3:4b-it-qat");
    expect(o.uncensored).toBe("dolphin-mistral");
  });
  it("requiredModels: bez/uncensored", () => {
    expect(requiredModels()).toEqual(["qwen3:1.7b", "qwen3.5:4b", "gemma3:4b-it-qat"]);
    expect(requiredModels({ uncensored: true })).toContain("dolphin-mistral");
  });
  it("katalog ma 4 role", () => {
    expect(PREMIUM_CATALOG.map((r) => r.role)).toEqual(["reflex", "balanced", "vision", "uncensored"]);
  });
});

describe("ollamaMaestro — missingModels", () => {
  it("z tagiem wymaga dokładnego dopasowania (rozmiar się liczy)", () => {
    expect(missingModels(["qwen3:1.7b", "qwen3.5:4b"], ["qwen3:1.7b", "gemma3:4b-it-qat"])).toEqual(["gemma3:4b-it-qat"]);
    expect(missingModels(["qwen3:4b"], ["qwen3:1.7b"])).toEqual(["qwen3:1.7b"]); // inny rozmiar = brakuje
  });
  it("bez tagu (dolphin-mistral) dopasowuje wariant bazowy (np. :latest)", () => {
    expect(missingModels(["dolphin-mistral:latest"], ["dolphin-mistral"])).toEqual([]);
  });
  it("nic nie brakuje → pusto", () => {
    expect(missingModels(["a:1", "b:2"], ["a:1", "b:2"])).toEqual([]);
  });
});

describe("ollamaMaestro — applyPremiumSetup (zapis ustawień)", () => {
  it("ustawia modele per rola i włącza premium-routing", () => {
    const sum = applyPremiumSetup();
    expect(store.settings.provider).toBe("ollama");
    expect(store.settings.ollamaModelSimple).toBe("qwen3:1.7b");
    expect(store.settings.ollamaModelComplex).toBe("qwen3.5:4b");
    expect(store.settings.ollamaModelVision).toBe("gemma3:4b-it-qat");
    expect(store.settings.localFirstSimple).toBe(true);
    expect(store.settings.confidenceGate).toBe(true);
    expect(store.settings.prewarmLocal).toBe(true);
    expect(store.settings.adaptiveRouter).toBe(true);
    expect(store.settings.unfilteredLocal).toBe(false); // domyślnie bez cenzury OFF
    expect(sum.overrides.complex).toBe("qwen3.5:4b");
  });
  it("uncensored=true włącza tryb nieocenzurowany i ustawia model", () => {
    applyPremiumSetup({ uncensored: true });
    expect(store.settings.unfilteredLocal).toBe(true);
    expect(store.settings.ollamaModelUncensored).toBe("dolphin-mistral");
  });
});

describe("ollamaMaestro — ensurePremiumModels (auto-pobieranie)", () => {
  it("pobiera tylko brakujące modele", async () => {
    vi.mocked(detectOllama).mockResolvedValue({ ok: true, url: "http://localhost:11434", models: ["qwen3:1.7b"] });
    vi.mocked(pullOllamaModel).mockResolvedValue({ ok: true });
    const r = await ensurePremiumModels({});
    expect(r.ok).toBe(true);
    expect(r.pulled).toEqual(["qwen3.5:4b", "gemma3:4b-it-qat"]); // qwen3:1.7b już jest
    expect(pullOllamaModel).toHaveBeenCalledTimes(2);
  });
  it("komplet już jest → nic nie pobiera", async () => {
    vi.mocked(detectOllama).mockResolvedValue({ ok: true, url: "u", models: ["qwen3:1.7b", "qwen3.5:4b", "gemma3:4b-it-qat"] });
    const r = await ensurePremiumModels({});
    expect(r.ok).toBe(true);
    expect(r.pulled).toEqual([]);
    expect(pullOllamaModel).not.toHaveBeenCalled();
  });
  it("brak połączenia → ok:false z błędem", async () => {
    vi.mocked(detectOllama).mockResolvedValue({ ok: false, url: "", models: [], error: "timeout" });
    const r = await ensurePremiumModels({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Nie połączono|timeout/i);
  });
  it("błąd pobierania → przerywa i raportuje", async () => {
    vi.mocked(detectOllama).mockResolvedValue({ ok: true, url: "u", models: [] });
    vi.mocked(pullOllamaModel).mockResolvedValueOnce({ ok: false, error: "brak miejsca" });
    const r = await ensurePremiumModels({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/brak miejsca/);
  });
});
