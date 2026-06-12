// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { askAnthropic } from "../src/lib/providers/anthropic";

afterEach(() => vi.unstubAllGlobals());

const ctx = () => ({
  system: "Jesteś JARVIS.",
  webSearch: false,
  tools: [],
  history: [{ role: "user" as const, content: "co słychać" }],
  apiKey: "sk-ant-test",
  model: "claude-opus-4-8",
});

describe("adapter Claude — odporność na brak adaptacyjnego myślenia", () => {
  it("po błędzie 400 o adaptive thinking ponawia BEZ thinking i zwraca odpowiedź", async () => {
    const bodies: any[] = [];
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if (bodies.length === 1) {
        // Pierwsza próba (z thinking) → dokładnie błąd ze zrzutu ekranu.
        return new Response(JSON.stringify({ error: { message: "adaptive thinking is not supported on this model" } }), { status: 400 });
      }
      // Druga próba (bez thinking) → normalna odpowiedź.
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Wszystko gra, Sir!" }], stop_reason: "end_turn" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await askAnthropic(ctx());
    expect(r.text).toBe("Wszystko gra, Sir!");
    // 1. próba miała thinking, 2. już nie.
    expect(bodies[0].thinking).toEqual({ type: "adaptive" });
    expect(bodies[1].thinking).toBeUndefined();
    expect(bodies[1].output_config).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("inny błąd 400 (np. zły klucz) NIE jest maskowany — leci wyjątek", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 400 })));
    await expect(askAnthropic(ctx())).rejects.toThrow(/invalid x-api-key/);
  });

  it("model wspierający thinking → jedna próba, z polami jakości", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" }));
    }));
    const r = await askAnthropic(ctx());
    expect(r.text).toBe("OK");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].output_config).toEqual({ effort: "high" });
  });
});
