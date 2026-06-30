import { describe, it, expect } from "vitest";
import {
  parseGeminiModels, inferCaps, pickGeminiModel, isPreviewModel, thinkingKindFor,
  fetchGeminiModels, getGeminiModels, FALLBACK_GEMINI_MODELS,
  type GeminiModelCaps,
} from "../src/lib/geminiCapabilities";

const RAW = {
  models: [
    { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent", "countTokens"], inputTokenLimit: 1048576 },
    { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-flash-preview-09-2025", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }, // nie-czat → pomijany
    { name: "models/gemini-2.5-flash-latest", supportedGenerationMethods: ["generateContent"] }, // alias latest
  ],
};

describe("geminiCapabilities — parsowanie i możliwości", () => {
  it("parsuje tylko modele czatu Gemini (pomija embeddingi)", () => {
    const list = parseGeminiModels(RAW);
    expect(list.some((m) => m.id === "gemini-2.5-flash")).toBe(true);
    expect(list.some((m) => m.id === "text-embedding-004")).toBe(false);
  });

  it("wnioskuje możliwości: wizja, function calling, structured output, myślenie", () => {
    const caps = inferCaps({ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] })!;
    expect(caps.vision).toBe(true);
    expect(caps.functionCalling).toBe(true);
    expect(caps.structuredOutput).toBe(true);
    expect(caps.thinking).toBe("budget");
  });

  it("rozpoznaje preview i rodzaj myślenia po rodzinie", () => {
    expect(isPreviewModel("gemini-2.5-flash-preview-09-2025")).toBe(true);
    expect(isPreviewModel("gemini-2.5-flash")).toBe(false);
    expect(thinkingKindFor("gemini-3-pro")).toBe("level");
    expect(thinkingKindFor("gemini-2.5-pro")).toBe("budget");
    expect(thinkingKindFor("gemini-2.0-flash")).toBe("none");
  });

  it("pickGeminiModel: maximum=pro, balanced=flash, economy=flash-lite; pomija preview i latest", () => {
    const list = parseGeminiModels(RAW);
    expect(pickGeminiModel(list, "maximum")).toBe("gemini-2.5-pro");
    expect(pickGeminiModel(list, "balanced")).toBe("gemini-2.5-flash");
    expect(pickGeminiModel(list, "economy")).toBe("gemini-2.5-flash-lite");
    // żaden wybór nie zwraca preview ani latest
    for (const mode of ["economy", "balanced", "maximum"] as const) {
      const id = pickGeminiModel(list, mode)!;
      expect(isPreviewModel(id)).toBe(false);
      expect(id).not.toMatch(/latest/);
    }
  });

  it("preview tylko po jawnym opt-in", () => {
    const previewOnly: GeminiModelCaps[] = [
      { id: "gemini-2.5-flash-preview-09-2025", generateContent: true, vision: true, functionCalling: true, structuredOutput: true, thinking: "budget", preview: true },
    ];
    expect(pickGeminiModel(previewOnly, "balanced")).toBeNull(); // bez opt-in
    expect(pickGeminiModel(previewOnly, "balanced", true)).toBe("gemini-2.5-flash-preview-09-2025");
  });
});

describe("geminiCapabilities — pobieranie i odporność", () => {
  const okFetch = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body } as Response);
  const errFetch = (status: number) => async () => ({ ok: false, status, json: async () => ({}) } as Response);

  it("fetchGeminiModels parsuje listę", async () => {
    const list = await fetchGeminiModels("KEY", okFetch(RAW));
    expect(list.some((m) => m.id === "gemini-2.5-pro")).toBe(true);
  });

  it("401/429 rzuca — getGeminiModels łapie i daje fallback (nie blokuje)", async () => {
    await expect(fetchGeminiModels("KEY", errFetch(401))).rejects.toThrow();
    await expect(fetchGeminiModels("KEY", errFetch(429))).rejects.toThrow();
  });

  it("brak klucza → fallback do znanych modeli", async () => {
    const list = await getGeminiModels("");
    expect(list).toEqual(FALLBACK_GEMINI_MODELS);
  });

  it("pusty wynik parsuje się do []", () => {
    expect(parseGeminiModels({ models: [] })).toEqual([]);
    expect(parseGeminiModels({})).toEqual([]);
    expect(parseGeminiModels(null)).toEqual([]);
  });
});
