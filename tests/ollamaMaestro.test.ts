// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/lib/privateMode", () => ({ detectOllama: vi.fn() }));
vi.mock("../src/lib/ollamaPull", () => ({ pullOllamaModel: vi.fn() }));

import { recommendedOverrides, requiredModels, missingModels, applyPremiumSetup, ensurePremiumModels, PREMIUM_CATALOG, paramB, autoAssignRoles, applyAutoFromInstalled, ADDABLE_MODELS } from "../src/lib/ollamaMaestro";
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

describe("ollamaMaestro — paramB + autoAssignRoles", () => {
  it("paramB wyciąga rozmiar z tagu", () => {
    expect(paramB("qwen3.5:4b")).toBe(4);
    expect(paramB("qwen3:1.7b")).toBe(1.7);
    expect(paramB("dolphin-mistral")).toBe(0);
  });

  it("dobiera najmniejszy jako szybki, największy jako mądry; wykrywa wizję i bez cenzury", () => {
    const o = autoAssignRoles(["qwen3:1.7b", "qwen3.5:4b", "llama3.2:3b", "llava:7b", "dolphin-mistral"]);
    expect(o.simple).toBe("qwen3:1.7b");      // najmniejszy ogólny
    expect(o.complex).toBe("qwen3.5:4b");     // największy ogólny (llava/dolphin wyłączone z „ogólnych")
    expect(o.vision).toBe("llava:7b");
    expect(o.uncensored).toBe("dolphin-mistral");
  });

  it("jeden model ogólny → szybki=mądry; brak wizji/uncensored → puste", () => {
    const o = autoAssignRoles(["qwen3.5:4b"]);
    expect(o.simple).toBe("qwen3.5:4b");
    expect(o.complex).toBe("qwen3.5:4b");
    expect(o.vision).toBe("");
    expect(o.uncensored).toBe("");
  });

  it("ADDABLE_MODELS to niepusty katalog z polami id/role/size/desc", () => {
    expect(ADDABLE_MODELS.length).toBeGreaterThan(4);
    expect(ADDABLE_MODELS[0]).toHaveProperty("id");
    expect(ADDABLE_MODELS[0]).toHaveProperty("desc");
  });
});

describe("ollamaMaestro — applyAutoFromInstalled", () => {
  it("konfiguruje role z zainstalowanych i włącza routing", async () => {
    vi.mocked(detectOllama).mockResolvedValue({ ok: true, url: "u", models: ["qwen3:1.7b", "qwen3.5:4b", "llava:7b"] });
    const r = await applyAutoFromInstalled();
    expect(r.ok).toBe(true);
    expect(store.settings.ollamaModelSimple).toBe("qwen3:1.7b");
    expect(store.settings.ollamaModelComplex).toBe("qwen3.5:4b");
    expect(store.settings.ollamaModelVision).toBe("llava:7b");
    expect(store.settings.localFirstSimple).toBe(true);
    expect(store.settings.localRefine).toBe(true);
  });
  it("brak modeli → błąd, nie konfiguruje na ślepo", async () => {
    vi.mocked(detectOllama).mockResolvedValue({ ok: true, url: "u", models: [] });
    const r = await applyAutoFromInstalled();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Brak modeli/);
  });
  it("brak połączenia → błąd", async () => {
    vi.mocked(detectOllama).mockResolvedValue({ ok: false, url: "", models: [], error: "timeout" });
    expect((await applyAutoFromInstalled()).ok).toBe(false);
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
