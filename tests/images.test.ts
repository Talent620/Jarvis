// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateImage, humanizeImageError, IMAGE_MODELS_LIST } from "../src/lib/images";
import { store } from "../src/lib/store";

const noKeys = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" };
const imgResp = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: "IMG", mimeType: "image/png" } }] } }] }), { status: 200 });

describe("Studio — modele edycji", () => {
  beforeEach(() => store.setSettings({ keys: { ...noKeys }, falApiKey: "", proxyUrl: "", studioKeys: "" }));

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

describe("humanizeImageError — czytelne komunikaty", () => {
  it("darmowy Gemini + limit → polski komunikat, bez angielskiego „quota”", () => {
    const out = humanizeImageError("You exceeded your current quota. Quota exceeded for metric...", "gemini");
    expect(out).toMatch(/limit/i);
    expect(out).toMatch(/Gemini/i);
    expect(out.toLowerCase()).not.toContain("quota");
  });

  it("premium fal.ai + błąd klucza → komunikat po polsku", () => {
    const out = humanizeImageError("401 Unauthorized: invalid api key", "fal-flux-kontext");
    expect(out).toMatch(/klucz/i);
    expect(out).not.toMatch(/Unauthorized/);
  });

  it("zwykły błąd przechodzi przez humanize", () => {
    const out = humanizeImageError("Failed to fetch", "gemini");
    expect(out).toMatch(/połączenia/i);
  });
});

describe("Studio — osobna pula kluczy (studioKeys) z rotacją", () => {
  beforeEach(() => store.setSettings({ keys: { ...noKeys }, falApiKey: "", studioKeys: "" }));
  afterEach(() => vi.unstubAllGlobals());

  it("limit na 1. kluczu Studia → rotacja na 2. (sukces)", async () => {
    store.setSettings({ studioKeys: "K1\nK2" });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("key=K1")) return new Response(JSON.stringify({ error: { message: "Quota exceeded for metric" } }), { status: 429 });
      return imgResp();
    }));
    const r = await generateImage("test", undefined, "gemini");
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.data).toBe("IMG");
    expect(calls.some((u) => u.includes("key=K1"))).toBe(true);
    expect(calls.some((u) => u.includes("key=K2"))).toBe(true);
  });

  it("puste studioKeys → Studio używa klucza Gemini z czatu", async () => {
    store.setSettings({ keys: { ...noKeys, gemini: "CHATKEY" } });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return imgResp(); }));
    const r = await generateImage("test", undefined, "gemini");
    expect("error" in r).toBe(false);
    expect(calls[0]).toContain("key=CHATKEY");
  });

  it("studioKeys ma pierwszeństwo przed kluczem czatu", async () => {
    store.setSettings({ keys: { ...noKeys, gemini: "CHATKEY" }, studioKeys: "STUDIOKEY" });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return imgResp(); }));
    await generateImage("test", undefined, "gemini");
    expect(calls[0]).toContain("key=STUDIOKEY");
    expect(calls.every((u) => !u.includes("CHATKEY"))).toBe(true);
  });
});
