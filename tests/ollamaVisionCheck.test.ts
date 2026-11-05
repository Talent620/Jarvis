import { afterEach, describe, expect, it, vi } from "vitest";
import { askOllamaNative } from "../src/lib/providers/ollama";
import type { AskCtx } from "../src/lib/providers/types";

afterEach(() => vi.unstubAllGlobals());
const ctx: AskCtx = { model: "fixture", apiKey: "local", system: "Opisz obraz", history: [{ role: "user", content: "Co widzisz?", image: { data: "aGVsbG8=", mediaType: "image/png" } }], tools: [], webSearch: false };
const config = { base: "http://localhost:11434", think: false, options: { num_ctx: 4096 } };

describe("Ollama: sprawdzenie możliwości obrazu", () => {
  it("odmawia analizy gdy metadane nie potwierdzają wizji", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ capabilities: ["completion"] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(askOllamaNative(ctx, config)).rejects.toThrow(/Nie mogę potwierdzić obsługi obrazów/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("przekazuje obraz tylko po potwierdzeniu vision przez usługę", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/api/show")) return new Response(JSON.stringify({ capabilities: ["completion", "vision"] }));
      const body = JSON.parse(String(init?.body));
      expect(body.messages[1].images).toEqual(["aGVsbG8="]);
      return new Response(JSON.stringify({ message: { role: "assistant", content: "Opis" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await askOllamaNative(ctx, config)).text).toBe("Opis");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
