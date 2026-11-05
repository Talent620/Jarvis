// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { askAnthropic } from "../src/lib/providers/anthropic";
import { askGemini } from "../src/lib/providers/gemini";
import { makeOpenAICompatible } from "../src/lib/providers/openai";
import type { AskCtx } from "../src/lib/providers/types";
import { store } from "../src/lib/store";
afterEach(() => vi.unstubAllGlobals());
const call = { name: "add_note", arguments: { text: "NIE_PO_STOP" } };
const cases = [
  { name: "OpenAI-compatible", impl: makeOpenAICompatible("https://fixture.invalid/chat"), data: { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } }] } },
  { name: "Anthropic", impl: askAnthropic, data: { content: [{ type: "tool_use", id: "1", name: call.name, input: call.arguments }], stop_reason: "tool_use" } },
  { name: "Gemini", impl: askGemini, data: { candidates: [{ content: { parts: [{ functionCall: { name: call.name, args: call.arguments } }] }, finishReason: "STOP" }] } },
];
it.each(cases)("$name nie wykonuje spóźnionego narzędzia po STOP", async ({ impl, data }) => {
  const controller = new AbortController();
  let deliver!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; })));
  const before = store.data.notes.length;
  const ctx: AskCtx = { model: "fixture", apiKey: "fixture", signal: controller.signal, system: "test", history: [{ role: "user", content: "dodaj notatkę" }], webSearch: false, tools: [{ name: call.name, description: "notatka", input_schema: { type: "object", properties: { text: { type: "string" } } } }] };
  const pending = impl(ctx);
  controller.abort(); deliver(new Response(JSON.stringify(data)));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(store.data.notes.length).toBe(before);
});

it.each(cases)("$name nie wykonuje narzędzia spoza udostępnionego zestawu", async ({ impl, data }) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data))));
  const before = store.data.notes.length;
  await expect(impl({ model: "fixture", apiKey: "fixture", system: "test", history: [], webSearch: false, tools: [] })).rejects.toThrow(/spoza udostępnionego zestawu/);
  expect(store.data.notes.length).toBe(before);
});
