import { describe, it, expect, vi } from "vitest";
import { runPlan, type RunDeps } from "../../src/lib/agentRun";
import type { AgentPlan } from "../../src/lib/agentPlanner";
import { confirmed } from "../../src/lib/actionOutcome";
import { Kernel } from "../../src/lib/runtime/kernel";

const plan: AgentPlan = {
  goal: "komentarze",
  steps: [
    { id: "a", intent: "scroll", tool: "t_read" },
    { id: "b", intent: "collect", tool: "t_read", dependsOn: ["a"] },
    { id: "c", intent: "send", tool: "t_out", dependsOn: ["b"] },
  ],
};

const deps = (over: Partial<RunDeps> = {}): RunDeps => ({
  toolExists: () => true,
  riskOf: (n) => (n === "t_out" ? "outbound" : "read"),
  requestConsent: async () => true,
  execTool: async () => ({ outcome: confirmed({ source: "mock" }) }),
  ...over,
});

describe("agentRun cancellation", () => {
  it("stop before a step: nothing new starts, remaining steps cancelled", async () => {
    const k = new Kernel();
    k.dispatch({ type: "TaskCreated", taskId: "A", goal: "x", kind: "k" });
    const execTool = vi.fn(async (name: string) => {
      if (name === "t_read" && execTool.mock.calls.length === 1) k.dispatch({ type: "ControlIntent", control: "stop", tier: 0 });
      return { outcome: confirmed({ source: "mock" }) };
    });
    const r = await runPlan(plan, deps({ execTool, signal: k.signal("A") }));
    expect(r.status).toBe("cancelled");
    expect(execTool).toHaveBeenCalledTimes(1);
    expect(r.steps.map((s) => [s.id, s.outcome.state, s.reason ?? ""])).toEqual([
      ["a", "CONFIRMED", ""],
      ["b", "DRAFT", "anulowano"],
      ["c", "DRAFT", "anulowano"],
    ]);
    expect(r.verdict.canClaimSuccess).toBe(false);
  });

  it("passes the signal to the tool; an outbound call aborted mid-flight is ATTEMPTED, not failed", async () => {
    const ctrl = new AbortController();
    const execTool = vi.fn(async (name: string, _a: unknown, _s: unknown, signal?: AbortSignal) => {
      if (name === "t_out") {
        return new Promise<never>((_, rej) => {
          signal?.addEventListener("abort", () => rej(new Error("aborted")));
          setTimeout(() => ctrl.abort(), 5);
        });
      }
      return { outcome: confirmed({ source: "mock" }) };
    });
    const r = await runPlan(plan, deps({ execTool, signal: ctrl.signal, recover: () => ({ action: "retry_backoff", delayMs: 0, reason: "x" }) }));
    expect(r.status).toBe("cancelled");
    const c = r.steps.find((s) => s.id === "c")!;
    expect(c.outcome.state).toBe("ATTEMPTED");
    expect(execTool.mock.calls.filter((call) => call[0] === "t_out")).toHaveLength(1); // never retried
  });

  it("a local step aborted mid-flight is cancelled and not retried", async () => {
    const ctrl = new AbortController();
    const execTool = vi.fn(async () => {
      ctrl.abort();
      throw new Error("aborted");
    });
    const r = await runPlan(plan, deps({ execTool, signal: ctrl.signal, recover: () => ({ action: "retry_backoff", delayMs: 0, reason: "x" }) }));
    expect(r.status).toBe("cancelled");
    expect(execTool).toHaveBeenCalledTimes(1);
    expect(r.steps[0]).toMatchObject({ skipped: true, reason: "anulowano" });
  });

  it("pause gate: the run waits between steps and continues after resume", async () => {
    const k = new Kernel();
    k.dispatch({ type: "TaskCreated", taskId: "A", goal: "x", kind: "k" });
    const order: string[] = [];
    const execTool = vi.fn(async (_n: string, _a: unknown, step: { id: string }) => {
      order.push(step.id);
      if (step.id === "a") k.dispatch({ type: "ControlIntent", control: "pause", tier: 0 });
      return { outcome: confirmed({ source: "mock" }) };
    });
    const run = runPlan(plan, deps({ execTool: execTool as unknown as RunDeps["execTool"], signal: k.signal("A"), gate: () => k.waitRunnable("A") }));
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["a"]);
    k.dispatch({ type: "ControlIntent", control: "resume", tier: 0 });
    const r = await run;
    expect(order).toEqual(["a", "b", "c"]);
    expect(r.status).toBe("completed");
  });

  it("cancel while paused ends the run without running more steps", async () => {
    const k = new Kernel();
    k.dispatch({ type: "TaskCreated", taskId: "A", goal: "x", kind: "k" });
    const execTool = vi.fn(async (_n: string, _a: unknown, step: { id: string }) => {
      if (step.id === "a") k.dispatch({ type: "ControlIntent", control: "pause", tier: 0 });
      return { outcome: confirmed({ source: "mock" }) };
    });
    const run = runPlan(plan, deps({ execTool: execTool as unknown as RunDeps["execTool"], signal: k.signal("A"), gate: () => k.waitRunnable("A") }));
    await new Promise((r) => setTimeout(r, 5));
    k.dispatch({ type: "ControlIntent", control: "stop", tier: 0 });
    const r = await run;
    expect(r.status).toBe("cancelled");
    expect(execTool).toHaveBeenCalledTimes(1);
  });

  it("without a signal the behaviour is unchanged", async () => {
    const r = await runPlan(plan, deps());
    expect(r.status).toBe("completed");
  });
});
