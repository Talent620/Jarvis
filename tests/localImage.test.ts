// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { sdTxt2ImgBody, sdImg2ImgBody, parseSdImage, diagnoseSdError, localSdGenerate, parseSdModels, detectSd, parseSdProgress } from "../src/lib/localImage";
import { store } from "../src/lib/store";

beforeEach(() => {
  store.setSettings({ sdUrl: "" });
  vi.unstubAllGlobals();
});

describe("localImage — budowa żądań (czyste)", () => {
  it("txt2img ma sensowne domyślne i przekazany prompt", () => {
    const b = sdTxt2ImgBody("kot w kapeluszu") as Record<string, number | string>;
    expect(b.prompt).toBe("kot w kapeluszu");
    expect(b.steps).toBe(28);
    expect(b.width).toBe(1024);
  });
  it("img2img dokłada init_images i denoising", () => {
    const b = sdImg2ImgBody("popraw", "BASE64DATA", { denoising: 0.4 }) as Record<string, unknown>;
    expect(b.init_images).toEqual(["BASE64DATA"]);
    expect(b.denoising_strength).toBe(0.4);
    expect(b.prompt).toBe("popraw");
  });
  it("nadpisania opcji działają", () => {
    const b = sdTxt2ImgBody("x", { steps: 12, width: 512, height: 768, negative: "blur" }) as Record<string, number | string>;
    expect(b.steps).toBe(12);
    expect(b.width).toBe(512);
    expect(b.height).toBe(768);
    expect(b.negative_prompt).toBe("blur");
  });
});

describe("localImage — parseSdImage", () => {
  it("zwraca base64 z pola images[0]", () => {
    expect(parseSdImage({ images: ["AAAA"] })).toEqual({ data: "AAAA", mediaType: "image/png" });
  });
  it("ucina prefiks data: gdy obecny", () => {
    expect(parseSdImage({ images: ["data:image/png;base64,BBBB"] })).toEqual({ data: "BBBB", mediaType: "image/png" });
  });
  it("brak obrazu → błąd", () => {
    expect(parseSdImage({})).toEqual({ error: expect.stringMatching(/nie zwrócił obrazu/i) });
  });
});

describe("localImage — diagnoseSdError", () => {
  it("https + http → mixed content", () => {
    expect(diagnoseSdError("http://192.168.0.10:7860", new TypeError("Failed to fetch"), true)).toMatch(/Mieszana|HTTPS/i);
  });
  it("failed to fetch → wskazuje flagi --api --listen --cors", () => {
    expect(diagnoseSdError("http://localhost:7860", new TypeError("Failed to fetch"), false)).toMatch(/--api|--cors-allow-origins/);
  });
  it("APK (natywnie) + http:// → NIE mixed-content (cleartext dozwolony), tylko realna diagnoza", () => {
    const m = diagnoseSdError("http://100.64.33.7:7860", new TypeError("Failed to fetch"), true, true);
    expect(m).not.toMatch(/Mieszana/i);
    expect(m).toMatch(/--api|--cors-allow-origins/);
  });
});

describe("localImage — localSdGenerate", () => {
  it("brak adresu → błąd, bez fetch", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await localSdGenerate("kot");
    expect("error" in r && r.error).toMatch(/adres serwera/i);
    expect(f).not.toHaveBeenCalled();
  });

  it("txt2img: strzela /sdapi/v1/txt2img i zwraca obraz", async () => {
    store.setSettings({ sdUrl: "http://localhost:7860/" });
    const f = vi.fn(async () => new Response(JSON.stringify({ images: ["IMG64"] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await localSdGenerate("zachód słońca nad górami");
    expect(r).toEqual({ data: "IMG64", mediaType: "image/png" });
    expect(String(f.mock.calls[0][0])).toBe("http://localhost:7860/sdapi/v1/txt2img");
  });

  it("ze zdjęciem: używa /sdapi/v1/img2img", async () => {
    store.setSettings({ sdUrl: "http://localhost:7860" });
    const f = vi.fn(async () => new Response(JSON.stringify({ images: ["OUT"] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await localSdGenerate("dodaj śnieg", [{ data: "INPUT64", mediaType: "image/png" }]);
    expect(String(f.mock.calls[0][0])).toContain("/sdapi/v1/img2img");
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.init_images).toEqual(["INPUT64"]);
  });

  it("HTTP błąd serwera → komunikat", async () => {
    store.setSettings({ sdUrl: "http://localhost:7860" });
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    const r = await localSdGenerate("x");
    expect("error" in r && r.error).toMatch(/500|--api/);
  });
});

describe("localImage — parseSdProgress", () => {
  it("zwraca progress 0..1 i przycina poza zakres", () => {
    expect(parseSdProgress({ progress: 0.42 })).toBe(0.42);
    expect(parseSdProgress({ progress: 1.5 })).toBe(1);
    expect(parseSdProgress({ progress: -0.2 })).toBe(0);
    expect(parseSdProgress({})).toBe(0);
    expect(parseSdProgress(null)).toBe(0);
  });
});

describe("localImage — detectSd + parseSdModels", () => {
  it("parseSdModels bierze model_name lub title", () => {
    expect(parseSdModels([{ model_name: "sd_xl_base" }, { title: "flux1-dev.safetensors" }, {}])).toEqual(["sd_xl_base", "flux1-dev.safetensors"]);
    expect(parseSdModels(null)).toEqual([]);
  });
  it("brak adresu → ok:false bez fetch", async () => {
    store.setSettings({ sdUrl: "" });
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await detectSd();
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("połączenie OK → lista modeli", async () => {
    store.setSettings({ sdUrl: "http://localhost:7860" });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify([{ model_name: "sdxl" }]), { status: 200 }));
    const r = await detectSd();
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["sdxl"]);
  });
});
