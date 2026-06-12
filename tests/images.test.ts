// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { generateImage, IMAGE_MODELS_LIST } from "../src/lib/images";
import { store } from "../src/lib/store";

const noKeys = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" };

describe("Studio — modele edycji", () => {
  beforeEach(() => store.setSettings({ keys: { ...noKeys }, falApiKey: "", proxyUrl: "" }));

  it("lista ma model darmowy i premium", () => {
    expect(IMAGE_MODELS_LIST.some((m) => m.tier === "free")).toBe(true);
    expect(IMAGE_MODELS_LIST.some((m) => m.tier === "premium")).toBe(true);
    expect(IMAGE_MODELS_LIST.find((m) => m.id === "gemini")?.tier).toBe("free");
  });

  it("darmowy bez klucza Gemini → czytelny błąd", async () => {
    const r = await generateImage("test", undefined, "gemini");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/Gemini/i);
  });

  it("premium bez klucza fal.ai → prosi o klucz", async () => {
    const img = { data: "AAAA", mediaType: "image/png" };
    const r = await generateImage("usuń naklejki", img, "fal-flux-kontext");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/fal\.ai/i);
  });

  it("premium z kluczem ale bez zdjęcia → prosi o zdjęcie", async () => {
    store.setSettings({ falApiKey: "fal-test" });
    const r = await generateImage("zrób packshot", undefined, "fal-nano-banana");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/zdjęcie/i);
  });
});
