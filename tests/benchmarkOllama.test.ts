// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseOllamaTiming, speedLabel, benchmarkModel, benchmarkModels } from "../src/lib/benchmarkOllama";
import { store } from "../src/lib/store";

beforeEach(() => { store.setSettings({ ollamaUrl: "http://localhost:11434" }); vi.unstubAllGlobals(); });

describe("benchmarkOllama — parseOllamaTiming", () => {
  it("liczy tokeny/s z eval_count i eval_duration (ns)", () => {
    // 48 tokenów w 2s (2e9 ns) = 24 tok/s; total 2.5s
    const t = parseOllamaTiming({ eval_count: 48, eval_duration: 2_000_000_000, total_duration: 2_500_000_000 });
    expect(t.tokPerSec).toBe(24);
    expect(t.ms).toBe(2500);
  });
  it("brak danych → 0", () => {
    expect(parseOllamaTiming({}).tokPerSec).toBe(0);
    expect(parseOllamaTiming(null).tokPerSec).toBe(0);
  });
});

describe("benchmarkOllama — speedLabel", () => {
  it("progi prędkości", () => {
    expect(speedLabel(50)).toMatch(/błyskawiczny/);
    expect(speedLabel(25)).toMatch(/szybki/);
    expect(speedLabel(12)).toMatch(/ok/);
    expect(speedLabel(5)).toMatch(/wolny/);
    expect(speedLabel(0)).toBe("—");
  });
});

describe("benchmarkOllama — benchmarkModel", () => {
  it("mierzy model i zwraca tokeny/s", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ response: "ok", done: true, eval_count: 30, eval_duration: 1_000_000_000, total_duration: 1_200_000_000 }), { status: 200 })));
    const r = await benchmarkModel("qwen3:1.7b");
    expect(r.ok).toBe(true);
    expect(r.tokPerSec).toBe(30);
    expect(r.ms).toBe(1200);
  });
  it("brak adresu → ok:false", async () => {
    store.setSettings({ ollamaUrl: "" });
    expect((await benchmarkModel("x")).ok).toBe(false);
  });
});

describe("benchmarkOllama — benchmarkModels (sortowanie)", () => {
  it("sortuje od najszybszego, błędne na końcu", async () => {
    const speeds: Record<string, number> = { fast: 40, slow: 8 };
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.model === "broken") return new Response("err", { status: 500 });
      const ec = speeds[body.model] ?? 10;
      return new Response(JSON.stringify({ eval_count: ec, eval_duration: 1_000_000_000, total_duration: 1_000_000_000 }), { status: 200 });
    }));
    const res = await benchmarkModels(["slow", "broken", "fast"]);
    expect(res.map((r) => r.model)).toEqual(["fast", "slow", "broken"]); // najszybszy → wolny → błędny
    expect(res[0].tokPerSec).toBe(40);
    expect(res[2].ok).toBe(false);
  });
});
