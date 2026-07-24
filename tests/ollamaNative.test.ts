import { afterEach, describe, expect, it, vi } from "vitest";
import { askOllamaNative } from "../src/lib/providers/ollama";

afterEach(() => vi.unstubAllGlobals());

describe("native Ollama adapter", () => {
  it("wysyła think=false i zwraca treść", async () => {
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.think).toBe(false);
      return new Response(JSON.stringify({ message: { role: "assistant", content: "Gotowe" }, eval_count: 2 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await askOllamaNative({
      apiKey: "local", model: "qwen3.5:4b", system: "x", history: [{ role: "user", content: "y" }], tools: [], webSearch: false,
    }, { base: "http://localhost:11434", think: false, options: { num_ctx: 4096 } });
    expect(result.text).toBe("Gotowe");
  });
});
