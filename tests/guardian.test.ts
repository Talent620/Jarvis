// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { speedSummary, voiceSummary, guardianAdvicePrompt, isOutgoingCommand, type GuardianStatus } from "../src/lib/guardian";
import { findSdServer } from "../src/lib/localImage";
import { store } from "../src/lib/store";

beforeEach(() => { vi.unstubAllGlobals(); store.setSettings({ sdUrl: "" }); });

describe("guardian — speedSummary", () => {
  it("bez myślenia i bez dodatkowych tur → szybki", () => {
    store.setSettings({ ollamaNoThink: true, localRefine: false, localConsensus: false });
    expect(speedSummary()).toMatch(/szybki/);
  });
  it("z myśleniem → mądry", () => {
    store.setSettings({ ollamaNoThink: false, localRefine: false, localConsensus: false });
    expect(speedSummary()).toMatch(/mądry/);
  });
  it("z dodatkową turą (refine) → mądry", () => {
    store.setSettings({ ollamaNoThink: true, localRefine: true });
    expect(speedSummary()).toMatch(/mądry/);
  });
});

describe("guardian — voiceSummary", () => {
  it("mowa wyłączona", () => {
    store.setSettings({ speak: false });
    expect(voiceSummary()).toMatch(/wyłączony/);
  });
  it("prosty polski systemowy (domyślnie)", () => {
    store.setSettings({ speak: true, voiceSystemPl: true });
    expect(voiceSummary()).toMatch(/polski/);
  });
});

describe("guardian — guardianAdvicePrompt", () => {
  it("zawiera stan i pytanie + po polsku", () => {
    const st: GuardianStatus = { brain: "lokalny (Ollama)", ollama: "ok", ollamaModels: 3, sd: "off", voiceLabel: "🇵🇱 polski", speedLabel: "⚡ szybki", issues: ["Brak modelu SD"] };
    const p = guardianAdvicePrompt(st, "jak przyspieszyć?");
    expect(p).toMatch(/po polsku/);
    expect(p).toMatch(/jak przyspieszyć/);
    expect(p).toMatch(/lokalny \(Ollama\)/);
    expect(p).toMatch(/Brak modelu SD/);
  });
});

describe("guardian — isOutgoingCommand", () => {
  it("działania wychodzące/nieodwracalne wymagają potwierdzenia", () => {
    expect(isOutgoingCommand("napisz i wyślij maila do Jana")).toBe(true);
    expect(isOutgoingCommand("zadzwoń do mamy")).toBe(true);
    expect(isOutgoingCommand("wyślij SMS do szefa")).toBe(true);
    expect(isOutgoingCommand("zrób przelew 200 zł")).toBe(true);
    expect(isOutgoingCommand("wyłącz światło w salonie")).toBe(true);
    expect(isOutgoingCommand("usuń to zadanie")).toBe(true);
    expect(isOutgoingCommand("wyślij oferty do leadów")).toBe(true);
  });
  it("bezpieczne polecenia idą od ręki (bez potwierdzenia)", () => {
    expect(isOutgoingCommand("dodaj zadanie na jutro")).toBe(false);
    expect(isOutgoingCommand("jaka jest pogoda")).toBe(false);
    expect(isOutgoingCommand("ile mam dziś spotkań")).toBe(false);
    expect(isOutgoingCommand("")).toBe(false);
  });
});

describe("localImage — findSdServer", () => {
  it("znajduje serwer SD odpowiadający na localhost:7860", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("7860")) return new Response(JSON.stringify([{ model_name: "sdxl" }]), { status: 200 });
      throw new TypeError("Failed to fetch");
    }));
    const r = await findSdServer();
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/7860/);
    expect(r.models).toEqual(["sdxl"]);
  });
  it("żaden nie odpowiada → ok:false z radą o --api", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const r = await findSdServer(["http://localhost:7860"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/--api|Forge|A1111/);
  });
});
