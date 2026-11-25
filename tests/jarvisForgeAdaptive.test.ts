import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  assessTaskDifficulty,
  composeAgentTeam,
  INTELLIGENCE_TIERS,
  scoreCandidateSolution,
  compareCompetitiveCandidates,
} from "../forge/adaptive.mjs";
import {
  createPromoBudgetGovernor,
  parseModalBillingSummary,
  validatePromoBudgetSpec,
} from "../forge/budget.mjs";
import { createProviderPool, pickBestLocalOllamaModel } from "../forge/providers.mjs";
import { executeCompetitiveForgeRun, executeForgeRun } from "../forge/engine.mjs";

const tempDirs: string[] = [];

function makeGitRepo(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-forge-adaptive-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "adaptive@jarvis.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Jarvis Adaptive"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const d = tempDirs.pop();
    if (d) fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("JARVIS FORGE — Adaptive Intelligence, Dynamic Teams & Competitive Solving", () => {
  it("1. Klasyfikator trudności i dynamiczny konstruktor zespołów (jakość > liczba agentów)", () => {
    const fakeRepo = { stats: { totalFiles: 6 }, profile: { testCommands: [{ command: "npm", args: ["test"] }] } };
    const matrix = [
      { id: "ollama", costCategory: "local_free", status: "ready", allowedInPolicy: true, installedModels: ["qwen2.5-coder:3b", "qwen3:4b"] },
      { id: "gemini", costCategory: "api_free", status: "ready", allowedInPolicy: true },
      { id: "modal", costCategory: "promo_credits", status: "ready", allowedInPolicy: true },
    ];

    const simple = assessTaskDifficulty({
      goal: "Fix a small bug in src/pricing.mjs discount rounding so npm test passes.",
      repoIndex: fakeRepo,
    });
    expect(simple.level).toBe("simple");
    expect(simple.targetTier).toBe(INTELLIGENCE_TIERS.LOCAL_FREE);
    const simpleTeam = composeAgentTeam({
      difficulty: simple,
      repoIndex: fakeRepo,
      providerMatrix: matrix,
      hardware: { tier: "cpu_light", gpu: null, totalRamGb: 8 },
      costPolicy: "allow_promo_credits",
      allowCompetitive: true,
      hasPromoBudget: true,
      isWorktreeReady: true,
    });
    expect(simpleTeam.teamPattern).toBe("lean_2_agent");
    expect(simpleTeam.skipArchitect).toBe(true);
    expect(simpleTeam.useCompetitive).toBe(false);
    expect(simpleTeam.initialTier).toBe(INTELLIGENCE_TIERS.LOCAL_FREE);

    const medium = assessTaskDifficulty({
      goal: "Add recurring expense feature across 4 files: src/validator.mjs, src/store.mjs, src/report.mjs, and src/index.mjs with new unit tests.",
      repoIndex: fakeRepo,
    });
    expect(medium.level).toBe("medium");
    expect(medium.targetTier).toBe(INTELLIGENCE_TIERS.API_FREE);
    const mediumTeam = composeAgentTeam({
      difficulty: medium,
      repoIndex: fakeRepo,
      providerMatrix: matrix,
      hardware: { tier: "cpu_light", gpu: null, totalRamGb: 8 },
      costPolicy: "allow_promo_credits",
      allowCompetitive: true,
      hasPromoBudget: true,
      isWorktreeReady: true,
    });
    expect(mediumTeam.teamPattern).toBe("disciplined_4_role");
    expect(mediumTeam.initialTier).toBe(INTELLIGENCE_TIERS.API_FREE);
    expect(mediumTeam.useCompetitive).toBe(false);

    const hard = assessTaskDifficulty({
      goal: "Design and implement from scratch a concurrent DAG task scheduler with topological cycle detection, maxConcurrency, retry with backoff, and AbortSignal cancellation.",
      repoIndex: fakeRepo,
    });
    expect(hard.level).toBe("hard");
    expect(hard.targetTier).toBe(INTELLIGENCE_TIERS.PROMO_CREDITS);
    const hardTeam = composeAgentTeam({
      difficulty: hard,
      repoIndex: fakeRepo,
      providerMatrix: matrix,
      hardware: { tier: "cpu_light", gpu: null, totalRamGb: 8 },
      costPolicy: "allow_promo_credits",
      allowCompetitive: true,
      hasPromoBudget: true,
      isWorktreeReady: true,
    });
    expect(hardTeam.teamPattern).toBe("competitive_dual_worktree");
    expect(hardTeam.useCompetitive).toBe(true);
    expect(hardTeam.initialTier).toBe(INTELLIGENCE_TIERS.PROMO_CREDITS);

    // Na cpu_light wyłącznie z lokalną Ollamą tryb konkurencyjny NIE uruchamia bezmyślnie 2 modeli jednocześnie!
    const cpuOnlyTeam = composeAgentTeam({
      difficulty: hard,
      repoIndex: fakeRepo,
      providerMatrix: [matrix[0]],
      hardware: { tier: "cpu_light", gpu: null, totalRamGb: 8 },
      costPolicy: "local_only",
      allowCompetitive: true,
      hasPromoBudget: false,
      isWorktreeReady: true,
    });
    expect(cpuOnlyTeam.useCompetitive).toBe(false);
    expect(cpuOnlyTeam.competitiveReason).toMatch(/cpu_light/i);
  });

  it("2. Zasady 1-5 Adaptive Intelligence: proste -> lokalne 0 USD (bez Architecta w leanSimple), porażka -> eskalacja na mocniejszy tier + niezależny Reviewer", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "adaptive-esc", type: "module", scripts: { test: "node --test" } }),
      "src/calc.mjs": "export function discount(p, pct) { return p - pct; }\n",
      "test/calc.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { discount } from '../src/calc.mjs'; test('10% off 200 = 180', () => assert.equal(discount(200, 10), 180));\n",
    });

    // Test 2A: Proste zadanie rozwiązane czysto lokalnym modelem (0 wywołań API / promo, pominięty Architect!)
    const poolSimple = createProviderPool({ env: {}, ollamaUrl: "http://127.0.0.1:1" });
    const callsSimple: string[] = [];
    let simpleDevStep = 0;
    poolSimple.registerCustomProvider("local_coder", {
      costTier: "local",
      rolePriority: { architect: 70, developer: 70, debugger: 70, reviewer: 70 },
      invoke: async ({ role }: { role: string }) => {
        callsSimple.push(`local:${role}`);
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        simpleDevStep += 1;
        if (simpleDevStep === 1) return { content: "", toolCalls: [{ id: "s1", name: "edit_file", arguments: { path: "src/calc.mjs", search: "return p - pct;", replace: "return p * (1 - pct / 100);" } }] };
        return { content: "", toolCalls: [{ id: "s2", name: "finish_task", arguments: { summary: "Fixed locally" } }] };
      },
    });
    poolSimple.registerCustomProvider("cloud_free", {
      costTier: "free_api",
      rolePriority: { architect: 98, developer: 98, debugger: 98, reviewer: 98 },
      invoke: async ({ role }: { role: string }) => {
        callsSimple.push(`cloud:${role}`);
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "Cross-model OK", issues: [] }), toolCalls: [] };
        return { content: "should not be called for simple dev", toolCalls: [] };
      },
    });

    const simpleRun = await executeForgeRun({
      goal: "Fix a small bug in src/calc.mjs discount formula.",
      repoRoot: repo,
      providerPool: poolSimple,
      costPolicy: "zero_cost",
      adaptive: true,
      leanSimple: true,
    });
    expect(simpleRun.status).toBe("completed");
    expect(simpleRun.difficulty.level).toBe("simple");
    expect(simpleRun.teamComposition.teamPattern).toBe("lean_2_agent");
    // Architect pominięty w leanSimple, Developer poszedł na local_coder (NIE cloud_free!)
    expect(callsSimple.some((c) => c.endsWith(":architect"))).toBe(false);
    expect(callsSimple.includes("local:developer")).toBe(true);
    expect(callsSimple.includes("cloud:developer")).toBe(false);

    // Test 2B: Słaby lokalny model zawodzi -> automatyczna eskalacja z local_free -> api_free + zmiana strategii -> PASS!
    const repoEsc = makeGitRepo({
      "package.json": JSON.stringify({ name: "adaptive-esc-2", type: "module", scripts: { test: "node --test" } }),
      "src/calc.mjs": "export function discount(p, pct) { return p - pct; }\n",
      "test/calc.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { discount } from '../src/calc.mjs'; test('10% off 200 = 180', () => assert.equal(discount(200, 10), 180));\n",
    });

    const poolEsc = createProviderPool({ env: {}, ollamaUrl: "http://127.0.0.1:1" });
    let weakStep = 0;
    let strongStep = 0;
    poolEsc.registerCustomProvider("weak_local", {
      costTier: "local",
      rolePriority: { architect: 70, developer: 70, debugger: 70, reviewer: 75 },
      invoke: async ({ role }: { role: string }) => {
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "Niezależny lokalny review OK", issues: [] }), toolCalls: [] };
        weakStep += 1;
        if (weakStep === 1) return { content: "", toolCalls: [{ id: "w1", name: "edit_file", arguments: { path: "src/calc.mjs", search: "return p - pct;", replace: "return p - pct * 3;" } }] };
        return { content: "", toolCalls: [{ id: "w2", name: "finish_task", arguments: { summary: "Błędna próba" } }] };
      },
    });
    poolEsc.registerCustomProvider("strong_api_free", {
      costTier: "free_api",
      rolePriority: { architect: 95, developer: 95, debugger: 95, reviewer: 85 },
      invoke: async ({ role }: { role: string }) => {
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        strongStep += 1;
        if (strongStep === 1) return { content: "", toolCalls: [{ id: "st1", name: "edit_file", arguments: { path: "src/calc.mjs", search: "return p - pct * 3;", replace: "return p * (1 - pct / 100);" } }] };
        return { content: "", toolCalls: [{ id: "st2", name: "finish_task", arguments: { summary: "Poprawiono po eskalacji" } }] };
      },
    });

    const escRun = await executeForgeRun({
      goal: "Fix a small bug in src/calc.mjs discount formula.",
      repoRoot: repoEsc,
      providerPool: poolEsc,
      costPolicy: "zero_cost",
      adaptive: true,
      leanSimple: true,
    });
    expect(escRun.status).toBe("completed");
    expect(escRun.activeIntelligenceTier).toBe(INTELLIGENCE_TIERS.API_FREE);
    expect(escRun.adaptiveTrace.some((t: { event: string; fromTier?: string; toTier?: string }) =>
      t.event === "intelligence_escalated" && t.fromTier === "local_free" && t.toTier === "api_free",
    )).toBe(true);
    expect(escRun.strategy).not.toBe("direct_patch");
    // Reviewer niezależny (lokalny recenzuje kod mocniejszego API!)
    expect(escRun.review?.reviewer).toContain("weak_local");

    // Cross-model lokalny w Ollamie: pickBestLocalOllamaModel dobiera INNY model przy recenzji
    const pickedRev = pickBestLocalOllamaModel(
      ["qwen2.5-coder:3b", "qwen3:4b"],
      "reviewer",
      { gpu: null, totalRamGb: 8 },
      { preferDifferentModelFrom: "qwen2.5-coder:3b" },
    );
    expect(pickedRev).toBe("qwen3:4b");
  });

  it("3. Rozliczenie opóźnione (delayed billing guard): nigdy nie zakłada, że Billed=$0.00 oznacza brak przyszłego obciążenia", () => {
    const parsed = parseModalBillingSummary(`
      Metered Cost: 55.25
      Deployed Apps: 13.13
      Ephemeral Apps: 0.94
      Credits: -14.06
      Billed Cost: $0.00
    `);
    expect(parsed.ephemeralAppsUsd).toBe(0.94);
    expect(parsed.remainingCreditsKnown).toBe(false);
    expect(parsed.delayedBillingRisk).toBe(true);

    // Przy znanym pozostałym saldzie $1.00 i 20% buforze efektywny limit NIE może przekroczyć $0.80!
    const spec = validatePromoBudgetSpec({
      maxExperimentUsd: 1.0,
      maxTotalUsd: 1.0,
      maxDurationSeconds: 120,
      knownRemainingCreditsUsd: 1.0,
      safetyReserveRatio: 0.2,
    });
    expect(spec.ok).toBe(true);
    expect(spec.normalized!.maxTotalUsd).toBe(0.8);
    expect(spec.normalized!.maxExperimentUsd).toBe(0.8);

    // Gdy pozostałe saldo <= 0 -> twarda blokada
    expect(validatePromoBudgetSpec({ maxExperimentUsd: 0.2, maxTotalUsd: 0.5, maxDurationSeconds: 60, knownRemainingCreditsUsd: 0 }).ok).toBe(false);

    const gov = createPromoBudgetGovernor({
      budgetSpec: { maxExperimentUsd: 0.2, maxTotalUsd: 0.5, maxDurationSeconds: 60, gpuSpec: "A100-40GB" },
      billingVerifier: () => ({ verified: true, available: true, billing: parsed }),
    });
    gov.assertCanSpend(10);
    const snap = gov.getSnapshot();
    expect(snap.outOfPocketUsd).toBe(0);
    expect(snap.delayedBillingRisk).toBe(true);
    expect(snap.remainingCreditsKnown).toBe(false);
    expect(snap.billingDisclaimer).toMatch(/opóźnienie|NIE oznacza/i);
    expect(snap.promoCreditsEphemeralReportedUsd).toBe(0.94);
  });

  it("4. Równoległy tryb konkurencyjny w izolowanych git worktree: obiektywny sędzia wybiera zwycięzcę z PASS i odrzuca gdy obaj zawiodą", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "comp-test", type: "module", scripts: { test: "node --test" } }),
      "src/queue.mjs": "export function sortJobs(jobs) { return jobs; }\n",
      "test/queue.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { sortJobs } from '../src/queue.mjs'; test('sorts by priority desc then id asc', () => assert.deepEqual(sortJobs([{id:'b',p:1},{id:'a',p:2},{id:'c',p:2}]).map(x=>x.id), ['a','c','b']));\n",
    });

    const pool = createProviderPool({ env: {}, ollamaUrl: "http://127.0.0.1:1" });
    let badCalls = 0;
    let goodCalls = 0;
    pool.registerCustomProvider("cand_weak", {
      costTier: "local",
      invoke: async ({ role }: { role: string }) => {
        if (role === "architect") return { content: JSON.stringify({ summary: "Sort", steps: [{ id: "s1", title: "edit", role: "developer" }] }), toolCalls: [] };
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        badCalls += 1;
        if (badCalls === 1) return { content: "", toolCalls: [{ id: "b1", name: "edit_file", arguments: { path: "src/queue.mjs", search: "return jobs;", replace: "return [...jobs].sort((a,b) => a.p - b.p);" } }] };
        return { content: "", toolCalls: [{ id: "b2", name: "finish_task", arguments: { summary: "Sorted asc (wrong)" } }] };
      },
    });
    pool.registerCustomProvider("cand_strong", {
      costTier: "free_api",
      invoke: async ({ role }: { role: string }) => {
        if (role === "architect") return { content: JSON.stringify({ summary: "Sort desc+tiebreak", steps: [{ id: "s1", title: "edit", role: "developer" }], targetFiles: ["src/queue.mjs"] }), toolCalls: [] };
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "Approved", issues: [] }), toolCalls: [] };
        goodCalls += 1;
        if (goodCalls === 1) {
          return {
            content: "",
            toolCalls: [{
              id: "g1",
              name: "edit_file",
              arguments: {
                path: "src/queue.mjs",
                search: "return jobs;",
                replace: "return [...jobs].sort((a, b) => (b.p - a.p) || a.id.localeCompare(b.id));",
              },
            }],
          };
        }
        return { content: "", toolCalls: [{ id: "g2", name: "finish_task", arguments: { summary: "Sorted desc + id tiebreak" } }] };
      },
    });

    const comp = await executeCompetitiveForgeRun({
      goal: "Fix sortJobs in src/queue.mjs to sort by priority descending with ascending id tie-break.",
      repoRoot: repo,
      providerPool: pool,
      costPolicy: "zero_cost",
      maxRepairCycles: 1,
      candidates: [
        { id: "weak-1", label: "cand_weak/local", preferredProvider: "cand_weak", costPolicy: "zero_cost", maxRepairCycles: 1 },
        { id: "strong-2", label: "cand_strong/api_free", preferredProvider: "cand_strong", costPolicy: "zero_cost", maxRepairCycles: 1 },
      ],
    });

    expect(comp.ok).toBe(true);
    expect(comp.status).toBe("completed");
    expect(comp.comparison.winnerId).toBe("strong-2");
    expect(comp.comparison.eligibleCount).toBe(1);
    expect(comp.comparison.parallelWorthIt).toBe(true);
    expect(comp.postMergeVerify?.ok).toBe(true);
    expect(comp.mergedFiles.map((m: { path: string }) => m.path)).toContain("src/queue.mjs");
    // Potwierdź, że w bazowym repo wylądowała wyłącznie poprawka zwycięzcy i testy przechodzą
    expect(fs.readFileSync(path.join(repo, "src/queue.mjs"), "utf8")).toContain("b.p - a.p");
    expect(execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" }).trim().split("\n").length).toBe(1);

    // Gdy obaj kandydaci zawodzą: zero scalania i czysty werdykt
    const scoredNone = compareCompetitiveCandidates([
      scoreCandidateSolution({ candidateId: "a", label: "A", runState: { status: "blocked", modifiedFiles: [] }, independentVerify: { ok: false } }),
      scoreCandidateSolution({ candidateId: "b", label: "B", runState: { status: "blocked", modifiedFiles: [] }, independentVerify: { ok: false } }),
    ]);
    expect(scoredNone.winnerId).toBeNull();
    expect(scoredNone.eligibleCount).toBe(0);
    expect(scoredNone.parallelWorthIt).toBe(false);
  });

  it("5. Zabezpieczenia z żywych testów: ochrona testów (protectedPaths), parser NDJSON małych modeli, odrzucanie 0-testów i rezerwacja równoległa budżetu", async () => {
    const { extractProtectedPaths } = await import("../forge/adaptive.mjs");
    const { extractInlineToolCallsFromText } = await import("../forge/providers.mjs");
    const { createForgeWorkspace } = await import("../forge/workspace.mjs");

    // 5a. Ochrona chronionych plików testowych ("Do not modify test/pricing.test.mjs") przed oszustwem małego modelu
    const goal = "Fix bugs in src/pricing.mjs so npm test passes. Do not modify test/pricing.test.mjs.";
    const prot = extractProtectedPaths(goal);
    expect(prot).toEqual(["test/pricing.test.mjs"]);

    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "prot-test", type: "module", scripts: { test: "node --test" } }),
      "src/pricing.mjs": "export const x = 1;\n",
      "test/pricing.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; test('ok', () => assert.equal(1, 1));\n",
    });
    const ws = createForgeWorkspace({ repoRoot: repo, runId: "prot-1", protectedPaths: prot });
    const cheatEdit = await ws.executeTool("edit_file", { path: "test/pricing.test.mjs", search: "assert.equal(1, 1)", replace: "assert.equal(1, 2)" });
    expect(cheatEdit.ok).toBe(false);
    expect(cheatEdit.error).toMatch(/chroniony/i);
    // Bezpieczny split jednoliniowego run_command bez metaznaków powłoki
    const singleStrCmd = await ws.executeTool("run_command", { command: "node --check src/pricing.mjs" });
    expect(singleStrCmd.ok).toBe(true);

    // 5b. Parser NDJSON z małych modeli Ollama emitujących wiele JSON-ów linia po linii
    const ndjson = '```json\n{"name": "read_file", "arguments": {"path": "src/a.mjs"}}\n{"name": "read_file", "arguments": {"path": "test/a.test.mjs"}}\n```';
    const parsedCalls = extractInlineToolCallsFromText(ndjson, [{ name: "read_file" }]);
    expect(parsedCalls.length).toBe(2);
    expect(parsedCalls[1].arguments.path).toBe("test/a.test.mjs");

    // 5c. Pusty projekt z 0 uruchomionymi testami NIE dostaje 50 pkt za testy
    const zeroScore = scoreCandidateSolution({
      candidateId: "empty",
      label: "empty",
      runState: { status: "blocked", modifiedFiles: [] },
      independentVerify: { ok: true, passCount: 0, failCount: 0 },
    });
    expect(zeroScore.testsPassed).toBe(false);
    expect(zeroScore.breakdown.testsScore).toBe(0);
    expect(zeroScore.eligible).toBe(false);

    // 5d. Równoległa rezerwacja budżetu w PromoBudgetGovernor blokuje wyścig 2 równoległych kandydatów ponad maxExperimentUsd
    const gov = createPromoBudgetGovernor({
      budgetSpec: { maxExperimentUsd: 0.02, maxTotalUsd: 0.05, maxDurationSeconds: 120, gpuSpec: "A100-40GB", safetyReserveRatio: 0.15 },
      billingVerifier: () => ({ verified: true, available: true, billing: { billedCostUsd: 0, hasPaidBilling: false } }),
    });
    const r1 = gov.assertCanSpend(20, { reserve: true }); // ~0.0134 USD
    expect(r1.reservedUsd).toBeGreaterThan(0.01);
    expect(() => gov.assertCanSpend(20, { reserve: true })).toThrow(/limit pojedynczego eksperymentu/i);
    gov.releaseReservation(r1.reservedUsd);
    expect(gov.getSnapshot().inFlightReservedUsd).toBe(0);
  });
});
