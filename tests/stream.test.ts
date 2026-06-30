import { describe, it, expect } from "vitest";
import { OAIStreamAccumulator, AnthStreamAccumulator, GeminiStreamAccumulator, drainSSE } from "../src/lib/stream";

describe("stream — OAIStreamAccumulator", () => {
  it("składa treść z delt i zwraca przyrost", () => {
    const acc = new OAIStreamAccumulator();
    expect(acc.push({ choices: [{ delta: { content: "Witaj" } }] })).toBe("Witaj");
    expect(acc.push({ choices: [{ delta: { content: ", Sir" } }] })).toBe(", Sir");
    expect(acc.push({ choices: [{ delta: {} }] })).toBe(""); // pusta delta
    expect(acc.content).toBe("Witaj, Sir");
  });

  it("składa wywołanie narzędzia z fragmentów (po index)", () => {
    const acc = new OAIStreamAccumulator();
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "add_task", arguments: '{"ti' } }] } }] });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tle":"x"}' } }] } }] });
    const tcs = acc.toolCalls();
    expect(tcs).toHaveLength(1);
    expect(tcs[0]).toEqual({ id: "c1", name: "add_task", arguments: '{"title":"x"}' });
  });

  it("czyta usage i finish_reason", () => {
    const acc = new OAIStreamAccumulator();
    acc.push({ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] });
    acc.push({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } });
    expect(acc.finishReason).toBe("stop");
    expect(acc.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });
});

describe("stream — drainSSE", () => {
  it("wyciąga kompletne zdarzenia, pomija [DONE] i nie-data linie", () => {
    const buf = 'data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n';
    const { events, rest } = drainSSE(buf);
    expect(events).toEqual([{ a: 1 }, { a: 2 }]);
    expect(rest).toBe("");
  });

  it("zatrzymuje niedokończony fragment jako rest (sklejanie między chunkami)", () => {
    const r1 = drainSSE('data: {"a":1}\n\ndata: {"a":2}');
    expect(r1.events).toEqual([{ a: 1 }]);
    expect(r1.rest).toBe('data: {"a":2}');
    // dokończenie w kolejnym chunku
    const r2 = drainSSE(r1.rest + '\n\n');
    expect(r2.events).toEqual([{ a: 2 }]);
  });

  it("pomija uszkodzony JSON bez wywrotki", () => {
    const { events } = drainSSE('data: {nie-json}\n\ndata: {"ok":true}\n\n');
    expect(events).toEqual([{ ok: true }]);
  });
});

describe("stream — AnthStreamAccumulator (Claude)", () => {
  it("składa tekst z delt + usage + stop_reason", () => {
    const acc = new AnthStreamAccumulator();
    acc.push({ type: "message_start", message: { usage: { input_tokens: 10 } } });
    acc.push({ type: "content_block_start", index: 0, content_block: { type: "text" } });
    expect(acc.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Dzień " } })).toBe("Dzień ");
    expect(acc.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "dobry" } })).toBe("dobry");
    acc.push({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } });
    expect(acc.content()).toEqual([{ type: "text", text: "Dzień dobry" }]);
    expect(acc.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(acc.stopReason).toBe("end_turn");
  });

  it("wiele message_delta: output_tokens to SUMA bieżąca, nie przyrost (brak zawyżania)", () => {
    const acc = new AnthStreamAccumulator();
    acc.push({ type: "message_start", message: { usage: { input_tokens: 10 } } });
    // Anthropic wysyła kumulatyw: 50, potem 120 — wynik ma być 120, nie 170.
    acc.push({ type: "message_delta", delta: {}, usage: { output_tokens: 50 } });
    acc.push({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 120 } });
    expect(acc.usage).toEqual({ inputTokens: 10, outputTokens: 120 });
  });

  it("składa tool_use z input_json_delta", () => {
    const acc = new AnthStreamAccumulator();
    acc.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "add_task" } });
    acc.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"x":' } });
    acc.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "1}" } });
    acc.push({ type: "content_block_stop", index: 0 });
    expect(acc.content()).toEqual([{ type: "tool_use", id: "t1", name: "add_task", input: { x: 1 } }]);
  });
});

describe("stream — GeminiStreamAccumulator", () => {
  it("składa tekst i functionCall + usage", () => {
    const acc = new GeminiStreamAccumulator();
    expect(acc.push({ candidates: [{ content: { parts: [{ text: "Cześć" }] } }] })).toBe("Cześć");
    acc.push({ candidates: [{ content: { parts: [{ functionCall: { name: "add_task", args: { t: "x" } } }] } }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 } });
    expect(acc.text).toBe("Cześć");
    expect(acc.calls()).toEqual([{ name: "add_task", args: { t: "x" } }]);
    expect(acc.usage).toEqual({ inputTokens: 8, outputTokens: 3 });
  });

  it("zachowuje thoughtSignature i id wywołania (pamięć planu Gemini)", () => {
    const acc = new GeminiStreamAccumulator();
    acc.push({ candidates: [{ content: { parts: [{ thoughtSignature: "SIG123", functionCall: { name: "find_leads", args: {}, id: "call-1" } }] } }] });
    const c = acc.calls()[0];
    expect(c.thoughtSignature).toBe("SIG123");
    expect(c.id).toBe("call-1");
  });

  it("dolicza thoughtsTokenCount do output (koszt myślenia)", () => {
    const acc = new GeminiStreamAccumulator();
    acc.push({ candidates: [{ content: { parts: [{ text: "x" }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4, thoughtsTokenCount: 10 } });
    expect(acc.usage.outputTokens).toBe(14); // 4 + 10
  });
});
