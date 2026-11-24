// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyFailure, reportFailure, reportSuccess, keyUsable, modelUsable, providerUsable,
  blockReason, healthSnapshot, reliabilityOf, resetHealth, keyFingerprint,
} from "../src/lib/autocore/health";
import {
  budgetState, budgetGate, budgetFilter, registerNewService, authorizeService, setDailyLimit,
  recordCall, markVerifiedFree, costClass, resetBudget,
} from "../src/lib/autocore/budget";
import {
  classifyTaskClass, rankForTask, notePrimary, routingLog, promote, promotionFor, checkRollback, resetRouter,
} from "../src/lib/autocore/router";
import { store } from "../src/lib/store";
import { emptyKeys } from "../src/lib/providers/registry";

beforeEach(() => {
  resetHealth();
  resetBudget();
  resetRouter();
  store.setSettings({ aiMonthlyBudgetUsd: 0, aiPricingOverrides: "", keys: { ...emptyKeys } });
  if (typeof localStorage !== "undefined") localStorage.clear();
});

describe("AUTOCORE health", () => {
  it("401 wyłącza dokładnie ten klucz do czasu zmiany klucza (odcisk)", () => {
    const t0 = 1_000_000;
    const c = reportFailure("groq", "m", "key-A", new Error("Unauthorized (401)"), t0);
    expect(c.kind).toBe("auth");
    expect(keyUsable("groq", "key-A", t0 + 1000)).toBe(false);
    expect(keyUsable("groq", "key-A", t0 + 365 * 24 * 3600_000)).toBe(false);
    expect(keyUsable("groq", "key-B", t0 + 1000)).toBe(true);
    expect(keyFingerprint("key-A")).not.toBe(keyFingerprint("key-B"));
    expect(blockReason("groq", "m", ["key-A"], {}, t0 + 1000)).toContain("401/403");
  });

  it("402 blokuje klucz na 24 h; 429 respektuje retryAfter", () => {
    const t0 = 1_000_000;
    expect(reportFailure("openrouter", "m", "k1", new Error("Payment required (402)"), t0).kind).toBe("payment");
    expect(keyUsable("openrouter", "k1", t0 + 23 * 3600_000)).toBe(false);
    expect(keyUsable("openrouter", "k1", t0 + 25 * 3600_000)).toBe(true);

    const err429 = Object.assign(new Error("Too many requests (429)"), { status: 429, retryAfter: 30 });
    expect(classifyFailure(err429, t0).retryAfterSec).toBe(30);
    reportFailure("gemini", "m", "g1", err429, t0);
    expect(keyUsable("gemini", "g1", t0 + 29_000)).toBe(false);
    expect(keyUsable("gemini", "g1", t0 + 31_000)).toBe(true);
  });

  it("404 model_missing wyłącza model na 24 h; capability wyłącza wizję na tym modelu", () => {
    const t0 = 1_000_000;
    expect(reportFailure("groq", "dead-model", "k", new Error("Model dead-model not found (404)"), t0).kind).toBe("model_missing");
    expect(modelUsable("groq", "dead-model", {}, t0 + 1000)).toBe(false);
    expect(modelUsable("groq", "other-model", {}, t0 + 1000)).toBe(true);

    expect(reportFailure("groq", "text-only", "k", new Error("image_url is not supported by this model (400)"), t0).kind).toBe("capability");
    expect(modelUsable("groq", "text-only", { needsVision: false }, t0 + 1000)).toBe(true);
    expect(modelUsable("groq", "text-only", { needsVision: true }, t0 + 1000)).toBe(false);
  });

  it("seria 3x 5xx uruchamia backoff dostawcy, sukces go zeruje", () => {
    const t0 = 1_000_000;
    reportFailure("mistral", "m", "k", new Error("Bad gateway (502)"), t0);
    reportFailure("mistral", "m", "k", new Error("Bad gateway (502)"), t0 + 10);
    expect(providerUsable("mistral", t0 + 20)).toBe(true);
    reportFailure("mistral", "m", "k", new Error("Bad gateway (502)"), t0 + 30);
    expect(providerUsable("mistral", t0 + 40)).toBe(false);
    reportSuccess("mistral", "m", "k", 250, t0 + 50);
    expect(providerUsable("mistral", t0 + 51)).toBe(true);
    expect(reliabilityOf("mistral")).toBeGreaterThan(0.2);
    expect(healthSnapshot(t0 + 51).find((h) => h.provider === "mistral")?.latencyEwma).toBe(250);
  });
});

describe("AUTOCORE budget", () => {
  it("nowo podłączona płatna/freemium usługa oczekuje na zatwierdzenie limitu; lokalna/free nie", () => {
    expect(registerNewService("ollama", "qwen3.5:4b")).toBe(false);
    expect(registerNewService("anthropic", "claude-haiku-4-5")).toBe(true);
    expect(budgetGate("anthropic", "claude-haiku-4-5").allowed).toBe(false);

    // Bez limitu (0) nie wolno zatwierdzić
    expect(authorizeService("anthropic", 0).ok).toBe(false);
    expect(authorizeService("anthropic", 10).ok).toBe(true);
    expect(budgetGate("anthropic", "claude-haiku-4-5").allowed).toBe(true);
  });

  it("markVerifiedFree oznacza model :free jako darmowy mimo braku klucza bezpłatnego", () => {
    markVerifiedFree("openrouter", ["meta-llama/llama-3.3-70b-instruct:free"]);
    expect(costClass("openrouter", "meta-llama/llama-3.3-70b-instruct:free")).toBe("free");
    expect(costClass("openrouter", "anthropic/claude-opus")).toBe("paid");
  });

  it("twardy stop po przekroczeniu limitu dziennego/miesięcznego; local nadal działa", () => {
    store.setSettings({ aiMonthlyBudgetUsd: 1 });
    setDailyLimit(0.05);
    const now = Date.now();
    // claude-opus-4-8: in 15/1M, out 75/1M → 1000 out = 0.075 USD > 0.05 daily
    recordCall("anthropic", "claude-opus-4-8", { inputTokens: 0, outputTokens: 1000 }, 500, now);
    expect(budgetState(now).level).toBe("stop");
    const f = budgetFilter([
      { provider: "anthropic", model: "claude-opus-4-8" },
      { provider: "ollama", model: "qwen3.5:4b" },
    ], now);
    expect(f.kept.map((x) => x.provider)).toEqual(["ollama"]);
    expect(f.blocked.map((x) => x.provider)).toEqual(["anthropic"]);
  });
});

describe("AUTOCORE router A–J + rollback", () => {
  it("klasyfikuje zadania do klas A–J", () => {
    expect(classifyTaskClass("cześć")).toBe("B_chat");
    expect(classifyTaskClass("napisz funkcję typescript do sortowania")).toBe("C_coding");
    expect(classifyTaskClass("przeanalizuj repozytorium i pull request")).toBe("D_repo");
    expect(classifyTaskClass("co jest na zdjęciu?", { hasImage: true })).toBe("E_vision");
    expect(classifyTaskClass("patrz", { hasImage: true, live: true })).toBe("F_live_vision");
    expect(classifyTaskClass("policz i udowodnij dlaczego tak jest")).toBe("A_reasoning");
    expect(classifyTaskClass("ustaw przypomnienie na jutro")).toBe("I_tools");
  });

  it("bez pomiarów kolejność = ranga; wizja filtruje bezwizyjne; presja kosztu obniża płatne na prostych", () => {
    const cands = [
      { provider: "groq" as const, model: "m", rank: 70 },
      { provider: "anthropic" as const, model: "c", rank: 100 },
      { provider: "gemini" as const, model: "g", rank: 80 },
    ];
    expect(rankForTask(cands, "B_chat").map((r) => r.item.provider)).toEqual(["anthropic", "gemini", "groq"]);
    expect(rankForTask(cands, "E_vision").map((r) => r.item.provider)).toEqual(["anthropic", "gemini"]);
    // Przy presji kosztów i prostym zadaniu: anthropic 100-30=70, ale remis z groq 70 wygrywa wyższa ranga (100 > 70), natomiast gemini 80 > 70!
    expect(rankForTask(cands, "B_chat", { costPressure: true }).map((r) => r.item.provider)[0]).toBe("gemini");
  });

  it("loguje zmiany routingu i robi rollback po 3 porażkach po promocji", () => {
    expect(notePrimary("C_coding", "gemini", "gemini-2.5-flash", "start")).toBe(true);
    expect(notePrimary("C_coding", "gemini", "gemini-2.5-flash", "to samo")).toBe(false);
    promote("C_coding", "groq", "kimi-k2", { provider: "gemini", model: "gemini-2.5-flash" }, { ok: 10, ko: 1 }, "lepszy wynik");
    expect(promotionFor("C_coding")?.provider).toBe("groq");
    // 1 porażka → jeszcze bez rollbacku
    expect(checkRollback("C_coding", { ok: 11, ko: 2 })).toBe(false);
    // 3 nowe porażki vs 1 nowy sukces → rollback
    expect(checkRollback("C_coding", { ok: 11, ko: 4 })).toBe(true);
    expect(promotionFor("C_coding")).toBeUndefined();
    expect(routingLog().some((e) => e.reason.includes("rollback"))).toBe(true);
  });
});
