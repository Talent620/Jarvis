// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PROVIDERS } from "../src/lib/providers/registry";
import { store } from "../src/lib/store";
import type { AskCtx } from "../src/lib/providers/types";

beforeEach(() => {
  vi.unstubAllGlobals();
  store.setSettings({ ollamaUrl: "http://localhost:11434" });
});

const ctx = (over: Partial<AskCtx> = {}): AskCtx =>
  ({
    system: "sys",
    history: [{ role: "user", content: "czesc" }],
    tools: [{ name: "save_lead", description: "d", input_schema: { type: "object", properties: {} } }],
    apiKey: "local",
    model: "dolphin-mistral",
    webSearch: false,
    ...over,
  }) as unknown as AskCtx;

describe("Ollama — model bez obsługi narzędzi (400) → ponów BEZ tools", () => {
  it("po '...does not support tools' ponawia bez tools i zwraca odpowiedź", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.tools) {
        return new Response(JSON.stringify({ error: { message: "registry.ollama.ai/library/dolphin-mistral:latest does not support tools" } }), { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Cześć! W czym pomóc?" } }], usage: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await PROVIDERS.ollama.impl(ctx());
    expect(r.text).toBe("Cześć! W czym pomóc?");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).tools).toBeUndefined();
  });

  it("model z obsługą tools → bez dodatkowego ponawiania", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }], usage: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await PROVIDERS.ollama.impl(ctx({ model: "qwen3.5:4b" }));
    expect(r.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
