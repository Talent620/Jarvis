import { describe, it, expect } from "vitest";
import { OAIStreamAccumulator, drainSSE } from "../src/lib/stream";

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
