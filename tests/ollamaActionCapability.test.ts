// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { askOllamaNative } from "../src/lib/providers/ollama";
import { store } from "../src/lib/store";
const config = { base: "http://127.0.0.1:11435", think: false, options: { num_ctx: 4096 } };
afterEach(() => vi.unstubAllGlobals());
it("zadanie akcyjne nie degraduje do fikcyjnego wykonania bez narzędzi", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "model does not support tools" }), { status: 400 }));
  vi.stubGlobal("fetch", fetch);
  await expect(askOllamaNative({ apiKey: "local", model: "fixture", system: "test", webSearch: false, history: [{ role: "user", content: "dodaj notatkę" }], tools: [{ name: "add_note", description: "notatka", input_schema: {} }], requiresTools: true }, config)).rejects.toThrow(/Nie wykonano działania/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("nie wykonuje narzędzia, którego nie udostępniono modelowi", async () => {
  const before = store.data.notes.length;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: { role: "assistant", tool_calls: [{ function: { name: "add_note", arguments: { text: "nieuprawniona" } } }] } }))));
  await expect(askOllamaNative({ apiKey: "local", model: "fixture", system: "test", webSearch: false, history: [], tools: [] }, config)).rejects.toThrow(/spoza udostępnionego zestawu/);
  expect(store.data.notes.length).toBe(before);
});
