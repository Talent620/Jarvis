// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { askOllamaNative } from "../src/lib/providers/ollama";
import { store } from "../src/lib/store";
import type { AskCtx } from "../src/lib/providers/types";

afterEach(() => vi.unstubAllGlobals());

describe("STOP: brak kolejnych efektów po anulowaniu", () => {
  it("blokuje spóźnione tool_calls nawet gdy transport nie respektuje anulowania", async () => {
    const ctrl = new AbortController();
    let deliver!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => { deliver = resolve; });
    const mock = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(new Response(JSON.stringify({ message: { role: "assistant", content: "Gotowe" } })));
    vi.stubGlobal("fetch", mock);
    const before = store.data.notes.length;
    const ctx: AskCtx & { signal: AbortSignal } = { apiKey: "local", model: "fixture", system: "test", history: [{ role: "user", content: "dodaj notatkę" }], tools: [{ name: "add_note", description: "Dodaj notatkę", input_schema: { type: "object", properties: { text: { type: "string" } } } }], webSearch: false, signal: ctrl.signal };
    const result = askOllamaNative(ctx, { base: "http://127.0.0.1:11435", think: false, options: { num_ctx: 4096 } });
    ctrl.abort();
    deliver(new Response(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "add_note", arguments: { text: "STOP_ORION" } } }] } })));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(store.data.notes.length).toBe(before);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("STOP: zgoda i paczka narzędzi", () => {
  it("nie rozpoczyna następnego narzędzia po STOP wewnątrz paczki", async () => {
    const ctrl = new AbortController();
    const before = store.data.notes.length;
    const unsubscribe = store.subscribe(() => { if (store.data.notes.length > before) ctrl.abort(); });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "add_note", arguments: { text: "ORION pierwszy" } } },
      { function: { name: "add_note", arguments: { text: "ORION drugi NIE WOLNO" } } },
    ] } }))));
    try {
      await expect(askOllamaNative({ apiKey: "local", model: "fixture", system: "test", history: [], tools: [{ name: "add_note", description: "Dodaj notatkę", input_schema: { type: "object", properties: { text: { type: "string" } } } }], webSearch: false, signal: ctrl.signal }, { base: "http://127.0.0.1:11435", think: false, options: { num_ctx: 4096 } })).rejects.toMatchObject({ name: "AbortError" });
      expect(store.data.notes.length).toBe(before + 1);
      expect(store.data.notes.some(n => n.text === "ORION drugi NIE WOLNO")).toBe(false);
    } finally { unsubscribe(); }
  });
});
