// === Samonaprawa (recoveryPolicy) — testy ===
// JARVIS wychodzi z błędu BEZ chaosu i bez podwójnych działań. Chwilowy błąd (nie-outbound) →
// retry z backoff. Outbound (mail/płatność/publikacja/usuwanie) → NIGDY auto-retry. Zły argument →
// replan pozostałych. Brak danych → pytanie. Odmowa zgody → skip. Trwały błąd → abort.
import { describe, it, expect, vi } from "vitest";
import { classifyError, decideRecovery, backoffMs, mayAutoRetry } from "../src/lib/recoveryPolicy";
import { runPlan, type RunDeps } from "../src/lib/agentRun";
import type { AgentPlan } from "../src/lib/agentPlanner";
import { confirmed } from "../src/lib/actionOutcome";

describe("recoveryPolicy — klasyfikacja błędów", () => {
  it("429 / quota → quota_429", () => {
    expect(classifyError({ status: 429 })).toBe("quota_429");
    expect(classifyError(new Error("Too Many Requests — rate limit"))).toBe("quota_429");
  });
  it("sieć/timeout/offline → transient_network", () => {
    expect(classifyError(new Error("network timeout"))).toBe("transient_network");
    expect(classifyError(new Error("fetch failed"))).toBe("transient_network");
    expect(classifyError({ status: 503 })).toBe("transient_network");
  });
  it("zły argument / 400 → bad_argument", () => {
    expect(classifyError({ status: 400 })).toBe("bad_argument");
    expect(classifyError(new Error("invalid argument"))).toBe("bad_argument");
  });
  it("brak danych / 404 → missing_data", () => {
    expect(classifyError({ status: 404 })).toBe("missing_data");
  });
  it("trwały błąd usługi (500/403) → permanent_service", () => {
    expect(classifyError({ status: 500 })).toBe("permanent_service");
    expect(classifyError({ status: 403 })).toBe("permanent_service");
  });
});

describe("recoveryPolicy — decyzje", () => {
  it("chwilowy błąd, akcja lokalna → retry z rosnącym backoff", () => {
    const d0 = decideRecovery({ kind: "transient_network", risk: "read", attempt: 0 });
    expect(d0.action).toBe("retry_backoff");
    expect(d0.delayMs).toBe(backoffMs(0));
    const d1 = decideRecovery({ kind: "transient_network", risk: "read", attempt: 1 });
    expect(d1.delayMs).toBeGreaterThan(d0.delayMs); // backoff rośnie
  });

  it("OUTBOUND nigdy nie jest auto-ponawiany (brak podwójnego maila) → ask_user", () => {
    const d = decideRecovery({ kind: "transient_network", risk: "outbound", attempt: 0 });
    expect(d.action).toBe("ask_user");
    expect(d.retryable).toBe(false);
    expect(mayAutoRetry("transient_network", "outbound")).toBe(false);
    expect(mayAutoRetry("quota_429", "read")).toBe(true);
  });

  it("zły argument → replan TYLKO pozostałych kroków (cel bez zmian)", () => {
    const d = decideRecovery({ kind: "bad_argument", risk: "read", attempt: 0 });
    expect(d.action).toBe("replan_remaining");
    expect(d.reason).toMatch(/pozosta/i);
  });

  it("odmowa zgody → skip; brak danych → ask_user; trwały błąd → abort", () => {
    expect(decideRecovery({ kind: "consent_denied", risk: "outbound", attempt: 0 }).action).toBe("skip");
    expect(decideRecovery({ kind: "missing_data", risk: "read", attempt: 0 }).action).toBe("ask_user");
    expect(decideRecovery({ kind: "permanent_service", risk: "read", attempt: 0 }).action).toBe("abort");
  });

  it("retry wyczerpany → abort", () => {
    const d = decideRecovery({ kind: "quota_429", risk: "read", attempt: 2, maxAttempts: 3 });
    expect(d.action).toBe("abort");
  });
});

describe("agentRun — samonaprawa w wykonaniu", () => {
  const recover = (err: unknown, risk: "read" | "write" | "outbound", attempt: number) =>
    decideRecovery({ kind: classifyError(err), risk, attempt, maxAttempts: 3 });
  const deps = (over: Partial<RunDeps>): RunDeps => ({
    toolExists: () => true, riskOf: () => "read",
    execTool: async () => ({ outcome: confirmed() }),
    recover, sleep: async () => {}, // natychmiast (bez realnego opóźnienia)
    ...over,
  });

  it("chwilowy błąd lokalnego narzędzia → ponawia i kończy sukcesem", async () => {
    let calls = 0;
    const execTool = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network timeout");
      return { outcome: confirmed({ source: "mock" }) };
    });
    const plan: AgentPlan = { goal: "x", steps: [{ id: "a", intent: "odczyt", tool: "list_tasks" }] };
    const r = await runPlan(plan, deps({ execTool }));
    expect(execTool).toHaveBeenCalledTimes(2); // 1 błąd + 1 udana
    expect(r.verdict.canClaimSuccess).toBe(true);
  });

  it("błąd OUTBOUND → NIE ponawia (jednokrotne wywołanie), brak sukcesu", async () => {
    const execTool = vi.fn(async () => { throw new Error("network timeout"); });
    const plan: AgentPlan = { goal: "wyślij", steps: [{ id: "a", intent: "mail", tool: "gmail_send", requiresConsent: true }] };
    const r = await runPlan(plan, deps({ riskOf: () => "outbound", execTool }));
    expect(execTool).toHaveBeenCalledTimes(1); // outbound nie jest ponawiany
    expect(r.verdict.canClaimSuccess).toBe(false);
  });
});
