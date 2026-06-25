// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateImage, humanizeImageError, IMAGE_MODELS_LIST, pollinationsUrl, bestImageModel, imageModelCost, geminiEditPrompt } from "../src/lib/images";
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

  it("Pollinations to darmowy generator BEZ klucza", () => {
    expect(IMAGE_MODELS_LIST.find((m) => m.id === "pollinations")?.tier).toBe("free");
  });

  it("pollinationsUrl: koduje opis, rozmiar i seed", () => {
    const u = pollinationsUrl("kot w kapeluszu", { width: 768, height: 512 }, 42);
    expect(u).toMatch(/image\.pollinations\.ai\/prompt\/kot%20w%20kapeluszu/);
    expect(u).toMatch(/width=768/);
    expect(u).toMatch(/height=512/);
    expect(u).toMatch(/seed=42/);
    expect(u).toMatch(/model=flux/);
  });

  it("bestImageModel: SD > Gemini > darmowy bez klucza", () => {
    store.setSettings({ keys: { ...noKeys }, studioKeys: "", sdUrl: "" });
    expect(bestImageModel()).toBe("pollinations"); // nic nie skonfigurowane
    store.setSettings({ keys: { ...noKeys, gemini: "K" } });
    expect(bestImageModel()).toBe("gemini");
    store.setSettings({ sdUrl: "http://localhost:7860" });
    expect(bestImageModel()).toBe("local-sd");
    store.setSettings({ sdUrl: "" });
  });

  it("imageModelCost: darmowe = 0, fal = cena za obraz", () => {
    expect(imageModelCost("pollinations")).toBe(0);
    expect(imageModelCost("gemini")).toBe(0);
    expect(imageModelCost("local-sd")).toBe(0);
    expect(imageModelCost("fal-flux-kontext")).toBeGreaterThan(0);
    expect(imageModelCost("fal-nano-banana")).toBeGreaterThan(imageModelCost("fal-flux-kontext"));
  });

  it("bestImageModel(forEdit): z kluczem fal.ai edycja idzie na fal (płatny), generowanie zostaje darmowe", () => {
    store.setSettings({ keys: { ...noKeys, gemini: "K" }, studioKeys: "", sdUrl: "", falApiKey: "fal-xxx" });
    expect(bestImageModel(false)).toBe("gemini"); // generowanie z opisu — darmowy
    expect(bestImageModel(true)).toBe("fal-flux-kontext"); // edycja zdjęcia — płatny fal.ai, który skonfigurowałeś
    store.setSettings({ falApiKey: "" });
    expect(bestImageModel(true)).toBe("gemini"); // bez klucza fal → Gemini
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

  it("premium z kluczem bez zdjęcia → GENERUJE z opisu (text→image), nie prosi o zdjęcie", async () => {
    store.setSettings({ falApiKey: "fal-test" });
    const r = await generateImage("zrób packshot", undefined, "fal-nano-banana");
    // W teście fetch jest mockowany → kończy się błędem sieci/HTTP, ale NIE komunikatem o dołączeniu zdjęcia.
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).not.toMatch(/dołącz zdjęcie|najpierw dołącz/i);
  });

  it("premium bez klucza fal.ai → prosi o klucz", async () => {
    store.setSettings({ falApiKey: "" });
    const r = await generateImage("packshot", undefined, "fal-flux-kontext");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/klucz\w* fal\.ai/i);
  });

  it("geminiEditPrompt: bez zdjęcia → prompt bez zmian; ze zdjęciem → kotwica edycji", () => {
    expect(geminiEditPrompt("kot w kapeluszu", false)).toBe("kot w kapeluszu");
    const anchored = geminiEditPrompt("wyczyść, usuń rysy", true);
    expect(anchored).toMatch(/DOŁĄCZONE zdjęcie/);
    expect(anchored).toMatch(/Nie twórz nowej/i);
    expect(anchored).toMatch(/wyczyść, usuń rysy$/); // oryginalne polecenie na końcu
  });

  it("Gemini + zdjęcie → żądanie niesie kotwicę edycji ORAZ bajty zdjęcia (inlineData)", async () => {
    store.setSettings({ keys: { ...noKeys, gemini: "K" } });
    let body: any = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => { body = JSON.parse(init.body); return imgResp(); }));
    const img = { data: "PHOTO64", mediaType: "image/jpeg" };
    const r = await generateImage("usuń rysy", img, "gemini");
    expect("error" in r).toBe(false);
    const parts = body.contents[0].parts;
    expect(parts[0].text).toMatch(/DOŁĄCZONE zdjęcie/); // kotwica edycji
    expect(parts.some((p: any) => p.inlineData?.data === "PHOTO64")).toBe(true); // zdjęcie wysłane
    vi.unstubAllGlobals();
  });

  it("Pollinations + dołączone zdjęcie → NIE zmyśla edycji, kieruje do edytora (bramka)", async () => {
    // Regresja: darmowy generator ignorował zdjęcie i tworzył losowy, niepasujący obraz.
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(String(url)); return new Response(new Blob([], { type: "image/jpeg" }), { status: 200 }); }));
    const img = { data: "AAAA", mediaType: "image/png" };
    const r = await generateImage("wyczyść, usuń rysy jakby był nowy", img, "pollinations");
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toMatch(/Gemini|edyt|przerobi/i);
      expect(r.error).toMatch(/NIE przerobi|nowy obraz/i);
    }
    expect(calls.length).toBe(0); // nie wysłał żadnego żądania generowania
    vi.unstubAllGlobals();
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
