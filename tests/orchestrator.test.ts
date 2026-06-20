// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { detectCycle, topoOrder, runGraph, type TaskNode } from "../src/lib/orchestrator";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("orchestrator — graf (pure)", () => {
  it("topoOrder respektuje zależności", () => {
    const nodes: TaskNode[] = [
      { id: "c", deps: ["a", "b"] },
      { id: "a" },
      { id: "b", deps: ["a"] },
    ];
    const order = topoOrder(nodes);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });
  it("detectCycle wykrywa cykl", () => {
    expect(detectCycle([{ id: "a", deps: ["b"] }, { id: "b", deps: ["a"] }])).not.toBeNull();
    expect(detectCycle([{ id: "a" }, { id: "b", deps: ["a"] }])).toBeNull();
  });
});

describe("orchestrator — runGraph", () => {
  it("uruchamia w kolejności zależności i przekazuje wyniki rodziców", async () => {
    const seen: string[] = [];
    const r = await runGraph<number>(
      [{ id: "a" }, { id: "b", deps: ["a"] }],
      async (n, deps) => { seen.push(n.id); return n.id === "a" ? 2 : (deps.a as number) * 10; },
    );
    expect(seen).toEqual(["a", "b"]);
    expect(r.results.b).toBe(20);
    expect(r.failed).toEqual([]);
  });

  it("niezależne węzły idą RÓWNOLEGLE (peak > 1)", async () => {
    let cur = 0, peak = 0;
    await runGraph(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      async () => { cur++; peak = Math.max(peak, cur); await tick(20); cur--; },
      { concurrency: 3 },
    );
    expect(peak).toBeGreaterThan(1);
  });

  it("retry: chwilowa porażka, potem sukces", async () => {
    let attempts = 0;
    const r = await runGraph<string>(
      [{ id: "x" }],
      async () => { attempts++; if (attempts < 3) throw new Error("flap"); return "ok"; },
      { retries: 3 },
    );
    expect(attempts).toBe(3);
    expect(r.results.x).toBe("ok");
    expect(r.failed).toEqual([]);
  });

  it("trwała porażka → węzeł failed, zależne POMINIĘTE (skipped)", async () => {
    const r = await runGraph(
      [{ id: "a" }, { id: "b", deps: ["a"] }, { id: "c", deps: ["b"] }, { id: "d" }],
      async (n) => { if (n.id === "a") throw new Error("nope"); return n.id; },
    );
    expect(r.failed).toContain("a");
    expect(r.skipped).toEqual(expect.arrayContaining(["b", "c"]));
    expect(r.results.d).toBe("d"); // niezależny węzeł i tak się wykonał
  });

  it("cykl → wszystko pominięte, bez zawieszenia", async () => {
    const r = await runGraph(
      [{ id: "a", deps: ["b"] }, { id: "b", deps: ["a"] }],
      async (n) => n.id,
    );
    expect(r.skipped.sort()).toEqual(["a", "b"]);
  });

  it("abort → reszta pominięta", async () => {
    const signal = { aborted: false };
    setTimeout(() => { signal.aborted = true; }, 10);
    const r = await runGraph(
      [{ id: "a" }, { id: "b", deps: ["a"] }],
      async () => { await tick(40); return 1; },
      { signal },
    );
    expect(r.skipped.length + r.failed.length).toBeGreaterThan(0);
  });
});
