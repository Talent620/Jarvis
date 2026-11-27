/**
 * JARVIS PHASE 4 — AUTOPILOT INTEGRATION & 5 REAL ACCEPTANCE SCENARIOS TEST SUITE.
 *
 * Weryfikuje:
 * 1. Audyt integracji (naprawione luki: project-memory ADR/checks bridge, izolacja pamięci multi-repo,
 *    filtracja kluczy w forgeClient, spięcie Jarvis Core tools <-> Autopilot Orchestrator).
 * 2. Bezpieczeństwo i niezmienialność budżetu (waiting_approval dla deploy/push/rm -rf/eskalacji,
 *    zakaz samo-zatwierdzania przez agenta, zakaz eskalacji do allow_paid przez agenta).
 * 3. Wszystkie 5 realnych scenariuszy akceptacyjnych end-to-end przez PRAWDZIWY serwer HTTP/SSE
 *    `forge/server.mjs`, PRAWDZIWE repozytoria Git (z worktree) i PRAWDZIWE uruchomienia `node --test`:
 *      S1: Prosta poprawka błędu (simple, lean_2_agent, 0 USD)
 *      S2: Rozbudowa funkcji w kilku plikach (medium, git worktree, strategy pivot FAIL->PASS, memory)
 *      S3: Stworzenie nowego modułu od zera (hard/greenfield, git worktree, test + rollback)
 *      S4: Przerwanie zadania i wznowienie z checkpointu (cancel -> paused -> resume -> PASS)
 *      S5: Brak dostępnego modelu (no_free_provider, 0 USD) ORAZ przekroczenie limitu czasu i iteracji
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { createForgeServer } from "../forge/server.mjs";
import { createProviderPool } from "../forge/providers.mjs";
import { createExperienceMemory } from "../forge/memory.mjs";
import {
  assessMissionSafety,
  decideAutopilotMission,
  enforceBudgetPolicyGuard,
  executeAutopilotMission,
  planAutopilotMission,
  rollbackAutopilotMission,
} from "../forge/autopilot.mjs";
import { collectJarvisProviderKeys, resetForgeSessionCache } from "../src/lib/forgeClient";
import { toolDefs } from "../src/lib/tools";
import { isClassified, isOperatorAutoAllowed, requiresFreshConsent, riskOf } from "../src/lib/permissions";
import { selectToolsForIntent } from "../src/lib/toolSelector";
import { resolveScreen } from "../src/lib/navIntent";
import { store } from "../src/lib/store";

const cleanupDirs: string[] = [];

function makeGitRepo(files: Record<string, string>, prefix = "jarvis-p4-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@jarvis.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Jarvis Test"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
  return dir;
}

async function apiJson(baseUrl: string, token: string, route: string, method = "GET", body?: unknown) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forge-Token": token,
      "X-Forge-Client": "jarvis-ui",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

afterEach(() => {
  resetForgeSessionCache();
  while (cleanupDirs.length) {
    const dir = cleanupDirs.pop()!;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("Phase 4 — Audyt integracji, pamięć projektu i bezpieczeństwo Core <-> Autopilot", () => {
  it("1. Project Memory Bridge wstrzykuje ADR-y i checki CURRENT_STATE.json do recallForContext", () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "mem-bridge", scripts: { test: "node --test" } }),
      "project-memory/journal/failed-attempts.md": "# Failed\n### FA-001: Lookbehind crash on Chrome 79\n",
      "project-memory/decisions/ADR-0009-forge.md": "# ADR-0009: Zero-Cost Autopilot Default\nStatus: accepted\n",
      "project-memory/CURRENT_STATE.json": JSON.stringify({
        checks: { lint: { status: "PASS" }, test: { status: "PASS" }, build: { status: "PASS" } },
      }),
    });
    const mem = createExperienceMemory(repo);
    const recall = mem.recallForContext({ goal: "Napraw bug w routerze" });
    expect(recall.adrs.length).toBeGreaterThanOrEqual(1);
    expect(recall.projectChecks.length).toBeGreaterThanOrEqual(3);
    expect(recall.text).toContain("ADR-0009-forge.md");
    expect(recall.text).toContain("lint=PASS");
    expect(recall.text).toContain("FA-001");
  });

  it("2. Izolacja pamięci multi-repo: pool utworzony dla Repo A zapisuje modelStats do Repo B przez memoryOverride", async () => {
    const repoA = makeGitRepo({ "package.json": JSON.stringify({ name: "repo-a" }) }, "jarvis-p4-a-");
    const repoB = makeGitRepo({
      "package.json": JSON.stringify({ name: "repo-b", scripts: { test: "node --test" } }),
      "src/calc.mjs": "export function add(a, b) { return a - b; }\n",
      "test/calc.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { add } from '../src/calc.mjs'; test('add', () => { assert.equal(add(2, 3), 5); });\n",
    }, "jarvis-p4-b-");

    const memA = createExperienceMemory(repoA);
    const pool = createProviderPool({ memory: memA, env: {} });
    let step = 0;
    pool.registerCustomProvider("local_sim", {
      costTier: "local",
      roleModels: { architect: "sim-arch", developer: "sim-dev", debugger: "sim-dev", reviewer: "sim-rev" },
      invoke: async ({ role }) => {
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        step += 1;
        if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "read_file", arguments: { path: "src/calc.mjs" } }] };
        if (step === 2) return { content: "", toolCalls: [{ id: "t2", name: "edit_file", arguments: { path: "src/calc.mjs", search: "return a - b;", replace: "return a + b;" } }] };
        return { content: "", toolCalls: [{ id: "t3", name: "finish_task", arguments: { summary: "Naprawiono add" } }] };
      },
    });

    const res = await executeAutopilotMission({
      goal: "Fix small bug in src/calc.mjs so add returns sum",
      repoRoot: repoB,
      providerPool: pool,
      probeLocal: false,
    });

    expect(res.ok).toBe(true);
    expect(res.verdict).toBe("PASS");
    const snapA = createExperienceMemory(repoA).getSnapshot();
    const snapB = createExperienceMemory(repoB).getSnapshot();
    expect(Object.keys(snapA.modelStats)).toHaveLength(0);
    expect(Object.keys(snapB.modelStats).length).toBeGreaterThanOrEqual(1);
  });

  it("3. Jarvis Core <-> Autopilot: 4 narzędzia zarejestrowane, RISK sklasyfikowane, toolSelector i navIntent podłączone, filtracja kluczy zero_cost", () => {
    for (const name of ["autopilot_run", "autopilot_status", "autopilot_decide", "autopilot_rollback"]) {
      expect(toolDefs.some((t) => t.name === name)).toBe(true);
      expect(isClassified(name)).toBe(true);
    }
    expect(riskOf("autopilot_status")).toBe("read");
    expect(riskOf("autopilot_run")).toBe("write");
    expect(riskOf("autopilot_decide")).toBe("outbound");
    expect(riskOf("autopilot_rollback")).toBe("outbound");
    expect(requiresFreshConsent("autopilot_decide")).toBe(true);
    expect(requiresFreshConsent("autopilot_rollback")).toBe(true);
    expect(isOperatorAutoAllowed("autopilot_decide", { runId: "r1", decision: "approve" })).toBe(false);

    const selected = selectToolsForIntent("uruchom autopilot i napraw błąd w repozytorium", toolDefs).map((t) => t.name);
    expect(selected).toContain("autopilot_run");
    expect(selected).toContain("autopilot_status");

    expect(resolveScreen("jarvis forge")?.id).toBe("forge");
    expect(resolveScreen("autopilot kodu")?.id).toBe("forge");

    // Filtracja kluczy: w zero_cost NIE wolno przekazywać anthropic ani modal!
    const origKeys = { ...store.settings.keys };
    try {
      store.setSettings({
        keys: { ...origKeys, gemini: "fake-gem-key", anthropic: "fake-paid-key", modal: "fake-modal-key" },
      });
      const zeroKeys = collectJarvisProviderKeys("zero_cost");
      expect(zeroKeys.gemini).toBe("fake-gem-key");
      expect(zeroKeys.anthropic).toBeUndefined();
      expect(zeroKeys.modal).toBeUndefined();

      const localKeys = collectJarvisProviderKeys("local_only");
      expect(localKeys.gemini).toBeUndefined();
      expect(localKeys.anthropic).toBeUndefined();

      const paidKeys = collectJarvisProviderKeys("allow_paid");
      expect(paidKeys.anthropic).toBe("fake-paid-key");
      expect(paidKeys.modal).toBe("fake-modal-key");
    } finally {
      store.setSettings({ keys: origKeys });
    }
  });

  it("4. Bramka bezpieczeństwa i niezmienialność budżetu: waiting_approval, brak samo-zatwierdzania i zakaz eskalacji przez agenta", async () => {
    expect(assessMissionSafety("Napraw test i wdrożenie na produkcję (deploy to production)").safeAuto).toBe(false);
    expect(assessMissionSafety("Wykonaj git push to main po naprawie").safeAuto).toBe(false);
    expect(assessMissionSafety("Zwiększ budżet i użyj płatnego API Claude").decisionKind).toBe("budget_escalation");
    expect(assessMissionSafety("Napraw funkcję liczenia rabatu w src/price.mjs").safeAuto).toBe(true);

    expect(() => enforceBudgetPolicyGuard({ requestedPolicy: "allow_paid", initiatedBy: "agent" })).toThrow(/BUDGET_ESCALATION|agent/i);
    expect(() => enforceBudgetPolicyGuard({ requestedPolicy: "allow_promo_credits", initiatedBy: "agent" })).toThrow(/agent/i);
    expect(() => enforceBudgetPolicyGuard({ requestedPolicy: "allow_paid", initiatedBy: "user", userApprovedPaid: false })).toThrow(/userApprovedPaid/i);

    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "safety-repo", scripts: { test: "node --test" } }),
      "src/app.mjs": "export const v = 1;\n",
      "test/app.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { v } from '../src/app.mjs'; test('v', () => assert.equal(v, 2));\n",
    });

    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    let step = 0;
    pool.registerCustomProvider("local_safe", {
      costTier: "local",
      invoke: async ({ role }) => {
        if (role === "architect") return { content: JSON.stringify({ summary: "Bump v", steps: [{ id: "s1", title: "edit", role: "developer" }], targetFiles: ["src/app.mjs"] }), toolCalls: [] };
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        step += 1;
        if (step === 1) return { content: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "src/app.mjs" } }] };
        if (step === 2) return { content: "", toolCalls: [{ id: "c2", name: "edit_file", arguments: { path: "src/app.mjs", search: "v = 1", replace: "v = 2" } }] };
        return { content: "", toolCalls: [{ id: "c3", name: "finish_task", arguments: { summary: "Updated v" } }] };
      },
    });

    const srv = createForgeServer({ defaultRepoRoot: repo, port: 0, providerPool: pool, runtimeDir: "" });
    const started = await srv.start();
    try {
      // Agent próbuje eskalować budżet przez HTTP -> twarde HTTP 403!
      const escRes = await apiJson(started.url, started.token, "/api/autopilot/run", "POST", {
        goal: "Napraw src/app.mjs",
        repoPath: repo,
        costPolicy: "allow_paid",
        initiatedBy: "agent",
      });
      expect(escRes.status).toBe(403);
      expect(escRes.data.code).toBe("BUDGET_ESCALATION_DENIED");

      // Misja z żądaniem git push -> wstrzymana w waiting_approval (0 zmian w repo!)
      const holdRes = await apiJson(started.url, started.token, "/api/autopilot/run", "POST", {
        goal: "Napraw src/app.mjs i wykonaj git push to main",
        repoPath: repo,
        wait: true,
        probe: false,
      });
      expect(holdRes.status).toBe(200);
      expect(holdRes.data.status).toBe("waiting_approval");
      expect(holdRes.data.verdict).toBe("WAITING_APPROVAL");
      expect(holdRes.data.decisionRequired).toBe(true);
      expect(fs.readFileSync(path.join(repo, "src/app.mjs"), "utf8")).toContain("v = 1");

      const runId = holdRes.data.run.id;
      // Nie wolno ominąć waiting_approval przez zwykłe /resume!
      const bypassResume = await apiJson(started.url, started.token, `/api/runs/${runId}/resume`, "POST", { repoPath: repo, wait: true });
      expect(bypassResume.status).toBe(409);

      // Agent nie może sam zatwierdzić zadania!
      const selfApprove = await apiJson(started.url, started.token, `/api/autopilot/${runId}/decide`, "POST", {
        repoPath: repo,
        decision: "approve",
        initiatedBy: "agent",
      });
      expect(selfApprove.status).toBe(403);
      expect(selfApprove.data.code).toBe("SELF_APPROVAL_DENIED");

      // Użytkownik zatwierdza jawnie -> wykonanie przechodzi i przechodzi testy!
      const approved = await apiJson(started.url, started.token, `/api/autopilot/${runId}/decide`, "POST", {
        repoPath: repo,
        decision: "approve",
        initiatedBy: "user",
        wait: true,
      });
      expect(approved.status).toBe(200);
      expect(approved.data.ok).toBe(true);
      expect(approved.data.verdict).toBe("PASS");
      expect(fs.readFileSync(path.join(repo, "src/app.mjs"), "utf8")).toContain("v = 2");

      // Druga misja ryzykowna odrzucona przez użytkownika -> BLOCKED, 0 zmian!
      const hold2 = await apiJson(started.url, started.token, "/api/autopilot/run", "POST", {
        goal: "Zrób npm publish nowej wersji",
        repoPath: repo,
        wait: true,
        probe: false,
      });
      const rejected = await apiJson(started.url, started.token, `/api/autopilot/${hold2.data.run.id}/decide`, "POST", {
        repoPath: repo,
        decision: "reject",
        wait: true,
      });
      expect(rejected.status).toBe(200);
      expect(rejected.data.verdict).toBe("BLOCKED");
      expect(rejected.data.run.modifiedFiles).toHaveLength(0);
    } finally {
      await srv.close();
    }
  });
});

describe("Phase 4 — 5 realnych scenariuszy akceptacyjnych end-to-end (HTTP/SSE + Git + real node --test)", () => {
  it("Scenariusz 1: Prosta poprawka błędu (zero-config -> lean_2_agent -> real test PASS -> cross-model review)", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "s1-bugfix", scripts: { test: "node --test" } }),
      "src/discount.mjs": [
        "export function applyDiscount(price, pct) {",
        "  if (pct < 0 || pct > 100) throw new RangeError('invalid pct');",
        "  return Number((price * (1 + pct / 100)).toFixed(2)); // BUG: + zamiast -",
        "}",
        "",
      ].join("\n"),
      "test/discount.test.mjs": [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { applyDiscount } from '../src/discount.mjs';",
        "test('20% discount on 100 = 80', () => { assert.equal(applyDiscount(100, 20), 80); });",
        "",
      ].join("\n"),
    });

    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    let devTurns = 0;
    let architectCalled = false;
    pool.registerCustomProvider("local_dev", {
      costTier: "local",
      roleModels: { architect: "qwen-local", developer: "qwen-local", debugger: "qwen-local", reviewer: "qwen-local" },
      invoke: async ({ role }) => {
        if (role === "architect") { architectCalled = true; return { content: "{}", toolCalls: [] }; }
        devTurns += 1;
        if (devTurns === 1) return { content: "", toolCalls: [{ id: "d1", name: "read_file", arguments: { path: "src/discount.mjs" } }] };
        if (devTurns === 2) {
          return {
            content: "",
            toolCalls: [{
              id: "d2",
              name: "edit_file",
              arguments: {
                path: "src/discount.mjs",
                search: "price * (1 + pct / 100)",
                replace: "price * (1 - pct / 100)",
              },
            }],
          };
        }
        return { content: "", toolCalls: [{ id: "d3", name: "finish_task", arguments: { summary: "Naprawiono znak rabatu" } }] };
      },
    });
    pool.registerCustomProvider("free_reviewer", {
      costTier: "free_api",
      roleModels: { architect: "free-r", developer: "free-r", debugger: "free-r", reviewer: "free-r" },
      rolePriority: { architect: 20, developer: 20, debugger: 20, reviewer: 99 },
      invoke: async () => ({
        content: JSON.stringify({ approved: true, summary: "Niezależna recenzja cross-model: poprawka rabatu poprawna i czysta.", issues: [] }),
        toolCalls: [],
      }),
    });

    const srv = createForgeServer({ defaultRepoRoot: repo, port: 0, providerPool: pool, runtimeDir: "" });
    const started = await srv.start();
    try {
      const res = await apiJson(started.url, started.token, "/api/autopilot/run", "POST", {
        goal: "Fix small discount bug in src/discount.mjs",
        repoPath: repo,
        wait: true,
        probe: false,
      });
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.verdict).toBe("PASS");
      expect(res.data.run.difficulty.level).toBe("simple");
      expect(res.data.run.teamComposition.teamPattern).toBe("lean_2_agent");
      expect(architectCalled).toBe(false); // Zero-config leanSimple pomija Architecta dla prostego zadania!
      expect(res.data.run.review.reviewer).toContain("free_reviewer/");
      expect(res.data.run.testResults.some((t: { ok: boolean }) => t.ok)).toBe(true);
      expect(res.data.run.attemptHistory.length).toBeGreaterThanOrEqual(1);
    } finally {
      await srv.close();
    }
  });

  it("Scenariusz 2: Rozbudowa funkcji w kilku plikach (medium -> auto git worktree -> FAIL->PASS strategy pivot -> memory)", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "s2-multifile", scripts: { test: "node --test" } }),
      "src/validator.mjs": "export function validateItem(item) { return Boolean(item && typeof item.title === 'string' && item.title.trim().length > 0); }\n",
      "src/store.mjs": "import { validateItem } from './validator.mjs';\nexport function createStore() {\n  const items = [];\n  return {\n    add(item) { if (!validateItem(item)) throw new Error('invalid'); items.push({ ...item }); return items.length; },\n    list() { return [...items]; },\n  };\n}\n",
      "test/app.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { createStore } from '../src/store.mjs'; test('basic add', () => { const s = createStore(); s.add({ title: 'A' }); assert.equal(s.list().length, 1); });\n",
    });

    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    let phaseTurn = 0;
    pool.registerCustomProvider("free_multi", {
      costTier: "free_api",
      roleModels: { architect: "free-m", developer: "free-m", debugger: "free-m", reviewer: "free-m" },
      invoke: async ({ role }) => {
        if (role === "architect") {
          return {
            content: JSON.stringify({
              summary: "Dodaj obsługę priorytetu i filtrowania po tagu w validator, store i testach",
              steps: [
                { id: "s1", title: "Rozszerz validator o opcjonalny priority (1-3)", role: "developer" },
                { id: "s2", title: "Dodaj metodę filterByPriority w store", role: "developer" },
                { id: "s3", title: "Dodaj testy jednostkowe", role: "developer" },
              ],
              targetFiles: ["src/validator.mjs", "src/store.mjs", "test/app.test.mjs"],
              decisionNote: "Walidacja priority w validator.mjs gwarantuje spójność przy zapisie w store.mjs",
            }),
            toolCalls: [],
          };
        }
        if (role === "reviewer") {
          return { content: JSON.stringify({ approved: true, summary: "Wszystkie 3 pliki spójne i pokryte testami.", issues: [] }), toolCalls: [] };
        }
        phaseTurn += 1;
        // Pierwsza próba celowo zawiera błąd w filterByPriority -> Verifier łapie FAIL i uruchamia Debugger + pivot!
        if (phaseTurn === 1) {
          return {
            content: "",
            toolCalls: [
              { id: "m1", name: "read_file", arguments: { path: "src/validator.mjs" } },
              { id: "m2", name: "read_file", arguments: { path: "src/store.mjs" } },
              { id: "m3", name: "read_file", arguments: { path: "test/app.test.mjs" } },
            ],
          };
        }
        if (phaseTurn === 2) {
          return {
            content: "",
            toolCalls: [
              {
                id: "m4",
                name: "edit_file",
                arguments: {
                  path: "src/validator.mjs",
                  search: "export function validateItem(item) { return Boolean(item && typeof item.title === 'string' && item.title.trim().length > 0); }",
                  replace: "export function validateItem(item) {\n  if (!item || typeof item.title !== 'string' || !item.title.trim()) return false;\n  if (item.priority !== undefined && (!Number.isInteger(item.priority) || item.priority < 1 || item.priority > 3)) return false;\n  return true;\n}",
                },
              },
              {
                id: "m5",
                name: "edit_file",
                arguments: {
                  path: "src/store.mjs",
                  search: "list() { return [...items]; },",
                  replace: "list() { return [...items]; },\n    filterByPriority(p) { return items.filter((it) => it.priority !== p); },",
                },
              },
              {
                id: "m6",
                name: "edit_file",
                arguments: {
                  path: "test/app.test.mjs",
                  search: "test('basic add', () => { const s = createStore(); s.add({ title: 'A' }); assert.equal(s.list().length, 1); });",
                  replace: "test('basic add', () => { const s = createStore(); s.add({ title: 'A' }); assert.equal(s.list().length, 1); });\ntest('priority validation and filtering', () => { const s = createStore(); assert.throws(() => s.add({ title: 'Bad', priority: 9 })); s.add({ title: 'High', priority: 1 }); s.add({ title: 'Low', priority: 3 }); assert.equal(s.filterByPriority(1).length, 1); assert.equal(s.filterByPriority(1)[0].title, 'High'); });",
                },
              },
            ],
          };
        }
        if (phaseTurn === 3) {
          return { content: "", toolCalls: [{ id: "m7", name: "finish_task", arguments: { summary: "Pierwsza implementacja" } }] };
        }
        if (phaseTurn === 4) {
          // Debugger naprawia !== p na === p
          return {
            content: "",
            toolCalls: [{
              id: "m8",
              name: "edit_file",
              arguments: {
                path: "src/store.mjs",
                search: "filterByPriority(p) { return items.filter((it) => it.priority !== p); }",
                replace: "filterByPriority(p) { return items.filter((it) => it.priority === p); }",
              },
            }],
          };
        }
        return { content: "", toolCalls: [{ id: "m9", name: "finish_task", arguments: { summary: "Naprawiono filtr priorytetu po teście" } }] };
      },
    });

    const srv = createForgeServer({ defaultRepoRoot: repo, port: 0, providerPool: pool, runtimeDir: "" });
    const started = await srv.start();
    try {
      const res = await apiJson(started.url, started.token, "/api/autopilot/run", "POST", {
        goal: "Add priority validation and filtering feature across src/validator.mjs, src/store.mjs, and test/app.test.mjs",
        repoPath: repo,
        wait: true,
        probe: false,
      });
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.verdict).toBe("PASS");
      expect(res.data.run.difficulty.level).toBe("medium");
      expect(res.data.run.worktreePath).toBeTruthy(); // Automatyczna izolacja git worktree dla clean repo!
      expect(res.data.run.modifiedFiles.length).toBe(3);
      expect(res.data.run.attemptHistory.length).toBe(2);
      expect(res.data.run.attemptHistory[0].ok).toBe(false);
      expect(res.data.run.attemptHistory[1].ok).toBe(true);

      // Sprawdź realne pliki po scaleniu worktree + realny test na repo bazowym
      const checkOut = execFileSync("node", ["--test"], { cwd: repo, encoding: "utf8" });
      expect(checkOut).toMatch(/pass 2/i);

      // Sprawdź, czy ExperienceMemory zapisała lekcję (FAIL -> PASS) oraz decyzję!
      const memSnap = createExperienceMemory(repo).getSnapshot();
      expect(memSnap.lessons.length).toBeGreaterThanOrEqual(1);
      expect(memSnap.decisions.length).toBeGreaterThanOrEqual(1);
    } finally {
      await srv.close();
    }
  });

  it("Scenariusz 3: Stworzenie nowego modułu od zera (greenfield -> hard -> worktree -> real tests PASS + rollback)", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "s3-greenfield", scripts: { test: "node --test" } }),
      "README.md": "# Greenfield Test Repo\n",
    });

    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    let turn = 0;
    pool.registerCustomProvider("free_green", {
      costTier: "free_api",
      invoke: async ({ role }) => {
        if (role === "architect") {
          return {
            content: JSON.stringify({
              summary: "Zbuduj moduł rateLimiter od zera wraz z testami",
              steps: [
                { id: "s1", title: "Utwórz src/rateLimiter.mjs", role: "developer" },
                { id: "s2", title: "Utwórz test/rateLimiter.test.mjs", role: "developer" },
              ],
              targetFiles: ["src/rateLimiter.mjs", "test/rateLimiter.test.mjs"],
              verifyCommands: [{ command: "node", args: ["--test", "test/rateLimiter.test.mjs"] }],
            }),
            toolCalls: [],
          };
        }
        if (role === "reviewer") {
          return { content: JSON.stringify({ approved: true, summary: "Moduł greenfield kompletny i przetestowany.", issues: [] }), toolCalls: [] };
        }
        turn += 1;
        if (turn === 1) {
          return {
            content: "",
            toolCalls: [
              {
                id: "g1",
                name: "write_file",
                arguments: {
                  path: "src/rateLimiter.mjs",
                  content: "export function createTokenBucket({ capacity = 3, refillMs = 1000, now = () => Date.now() } = {}) {\n  let tokens = capacity;\n  let last = now();\n  return {\n    take() {\n      const t = now();\n      const gained = Math.floor((t - last) / refillMs);\n      if (gained > 0) { tokens = Math.min(capacity, tokens + gained); last += gained * refillMs; }\n      if (tokens <= 0) return false;\n      tokens -= 1;\n      return true;\n    },\n    remaining() { return tokens; },\n  };\n}\n",
                },
              },
              {
                id: "g2",
                name: "write_file",
                arguments: {
                  path: "test/rateLimiter.test.mjs",
                  content: "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createTokenBucket } from '../src/rateLimiter.mjs';\ntest('rate limiter enforces capacity and refills', () => {\n  let clock = 0;\n  const lim = createTokenBucket({ capacity: 2, refillMs: 500, now: () => clock });\n  assert.equal(lim.take(), true);\n  assert.equal(lim.take(), true);\n  assert.equal(lim.take(), false);\n  clock = 500;\n  assert.equal(lim.take(), true);\n});\n",
                },
              },
            ],
          };
        }
        return { content: "", toolCalls: [{ id: "g3", name: "finish_task", arguments: { summary: "Utworzono rateLimiter i testy" } }] };
      },
    });

    const srv = createForgeServer({ defaultRepoRoot: repo, port: 0, providerPool: pool, runtimeDir: "" });
    const started = await srv.start();
    try {
      const res = await apiJson(started.url, started.token, "/api/autopilot/run", "POST", {
        goal: "Design and implement from scratch a token-bucket rate limiter module in src/rateLimiter.mjs with unit tests in test/rateLimiter.test.mjs",
        repoPath: repo,
        wait: true,
        probe: false,
      });
      expect(res.status).toBe(200);
      expect(res.data.ok).toBe(true);
      expect(res.data.verdict).toBe("PASS");
      expect(res.data.run.difficulty.level).toBe("hard");
      expect(fs.existsSync(path.join(repo, "src/rateLimiter.mjs"))).toBe(true);
      expect(fs.existsSync(path.join(repo, "test/rateLimiter.test.mjs"))).toBe(true);

      const testOut = execFileSync("node", ["--test", "test/rateLimiter.test.mjs"], { cwd: repo, encoding: "utf8" });
      expect(testOut).toMatch(/pass 1/i);
    } finally {
      await srv.close();
    }
  });

  it("Scenariusz 4: Przerwanie zadania (cancel) i bezstratne wznowienie z checkpointu -> PASS + Rollback", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "s4-resume", scripts: { test: "node --test" } }),
      "src/math.mjs": "export function mul(a, b) { return a + b; }\n",
      "test/math.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { mul } from '../src/math.mjs'; test('mul', () => assert.equal(mul(4, 5), 20));\n",
    });

    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    let callCount = 0;
    let markCall2Started: (() => void) | null = null;
    const call2Started = new Promise<void>((resolve) => { markCall2Started = resolve; });
    pool.registerCustomProvider("local_slow", {
      costTier: "local",
      invoke: async ({ role, signal }) => {
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK po wznowieniu", issues: [] }), toolCalls: [] };
        callCount += 1;
        if (callCount === 1) {
          return { content: "", toolCalls: [{ id: "r1", name: "read_file", arguments: { path: "src/math.mjs" } }] };
        }
        if (callCount === 2) {
          markCall2Started?.();
          // Symulacja długiego wywołania przerywanego przez Kill-Switch / limit czasu
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 4000);
            signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Aborted")); }, { once: true });
          });
          return { content: "", toolCalls: [] };
        }
        if (callCount === 3) {
          return {
            content: "",
            toolCalls: [{ id: "r2", name: "edit_file", arguments: { path: "src/math.mjs", search: "return a + b;", replace: "return a * b;" } }],
          };
        }
        return { content: "", toolCalls: [{ id: "r3", name: "finish_task", arguments: { summary: "Naprawiono mul po wznowieniu" } }] };
      },
    });

    const srv = createForgeServer({ defaultRepoRoot: repo, port: 0, providerPool: pool, runtimeDir: "" });
    const started = await srv.start();
    try {
      // 1. Uruchom asynchronicznie i przerwij (cancel) dokładnie w trakcie 2. wywołania LLM
      const launch = await apiJson(started.url, started.token, "/api/autopilot/run", "POST", {
        goal: "Fix small bug in src/math.mjs so mul multiplies",
        repoPath: repo,
        probe: false,
      });
      expect(launch.status).toBe(202);
      const runId = launch.data.runId as string;
      expect(runId).toBeTruthy();

      await Promise.race([call2Started, new Promise((r) => setTimeout(r, 2500))]);
      const cancelRes = await apiJson(started.url, started.token, `/api/runs/${runId}/cancel?path=${encodeURIComponent(repo)}`, "POST", {});
      expect(cancelRes.status).toBe(200);

      // Poczekaj aż checkpoint zapisze status "paused"
      let pausedState = null;
      for (let i = 0; i < 40; i += 1) {
        const cur = await apiJson(started.url, started.token, `/api/runs/${runId}?path=${encodeURIComponent(repo)}`);
        if (cur.data?.run?.status === "paused") { pausedState = cur.data.run; break; }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(pausedState?.status).toBe("paused");
      expect(pausedState?.verdict).toBe("PAUSED");

      // 2. Wznów z checkpointu -> powinno ukończyć zadanie i zaliczyć test!
      const resumed = await apiJson(started.url, started.token, `/api/runs/${runId}/resume`, "POST", {
        repoPath: repo,
        wait: true,
      });
      expect(resumed.status).toBe(200);
      expect(resumed.data.verdict).toBe("PASS");
      expect(resumed.data.run.status).toBe("completed");
      expect(resumed.data.run.resumedCount).toBeGreaterThanOrEqual(1);
      expect(fs.readFileSync(path.join(repo, "src/math.mjs"), "utf8")).toContain("return a * b;");

      // 3. Sprawdź deterministyczny rollback
      const rb = rollbackAutopilotMission({ runId, repoRoot: repo });
      expect(rb.restoredCount).toBeGreaterThanOrEqual(1);
      expect(fs.readFileSync(path.join(repo, "src/math.mjs"), "utf8")).toContain("return a + b;");
    } finally {
      await srv.close();
    }
  });

  it("Scenariusz 5: Brak modelu (no_free_provider, 0 USD), przekroczenie limitu czasu (time_limit) i limitu iteracji (BLOCKED)", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "s5-limits", scripts: { test: "node --test" } }),
      "src/broken.mjs": "export const val = 0;\n",
      "test/broken.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { val } from '../src/broken.mjs'; test('val', () => assert.equal(val, 42));\n",
    });

    // 5a: Brak jakiegokolwiek gotowego darmowego dostawcy -> uczciwe BLOCKED, zero cichego płatnego fallbacku!
    const emptyPool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    const planNoModel = await planAutopilotMission({
      goal: "Fix small bug in src/broken.mjs",
      repoRoot: repo,
      providerPool: emptyPool,
      probeLocal: false,
    });
    expect(planNoModel.canExecute).toBe(false);
    expect(planNoModel.decisionRequired).toBe(true);
    expect(planNoModel.pendingDecision?.kind).toBe("no_free_provider");

    const noModelRun = await executeAutopilotMission({
      goal: "Fix small bug in src/broken.mjs",
      repoRoot: repo,
      providerPool: emptyPool,
      probeLocal: false,
    });
    expect(noModelRun.ok).toBe(false);
    expect(noModelRun.verdict).toBe("BLOCKED");
    expect(noModelRun.status).toBe("blocked");
    expect(noModelRun.run?.pendingDecision?.kind).toBe("no_free_provider");

    // 5b: Przekroczenie limitu czasu zegarowego (maxDurationMs = 90 ms) -> czysty checkpoint PAUSED (time_limit)!
    const slowPool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    slowPool.registerCustomProvider("local_timeout", {
      costTier: "local",
      invoke: async ({ signal }) => {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 2500);
          signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("TIME_LIMIT_EXCEEDED")); }, { once: true });
        });
        return { content: "", toolCalls: [] };
      },
    });
    const timedOut = await executeAutopilotMission({
      goal: "Fix small bug in src/broken.mjs",
      repoRoot: repo,
      providerPool: slowPool,
      maxDurationMs: 90,
      probeLocal: false,
    });
    expect(timedOut.ok).toBe(false);
    expect(timedOut.status).toBe("paused");
    expect(timedOut.verdict).toBe("PAUSED");
    expect(timedOut.run?.pauseReason).toBe("time_limit");
    expect(timedOut.run?.pendingDecision?.kind).toBe("time_limit");

    // 5c: Przekroczenie limitu iteracji/napraw gdy test wciąż nie przechodzi -> uczciwe BLOCKED (nigdy nie udaje PASS!)
    const stubbornPool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    let stubStep = 0;
    stubbornPool.registerCustomProvider("local_stubborn", {
      costTier: "local",
      invoke: async () => {
        stubStep += 1;
        if (stubStep % 2 === 1) {
          return { content: "", toolCalls: [{ id: `s${stubStep}`, name: "edit_file", arguments: { path: "src/broken.mjs", search: `val = ${stubStep === 1 ? 0 : 1}`, replace: "val = 1" } }] };
        }
        return { content: "", toolCalls: [{ id: `f${stubStep}`, name: "finish_task", arguments: { summary: "Próba naprawy" } }] };
      },
    });
    const limitRes = await executeAutopilotMission({
      goal: "Fix small bug in src/broken.mjs",
      repoRoot: repo,
      providerPool: stubbornPool,
      maxIterations: 4,
      maxRepairCycles: 1,
      probeLocal: false,
    });
    expect(limitRes.ok).toBe(false);
    expect(limitRes.verdict).toBe("BLOCKED");
    expect(limitRes.status).toBe("blocked");
    expect(limitRes.run?.pendingDecision?.required).toBe(true);
    expect(limitRes.run?.attemptHistory?.length).toBeGreaterThanOrEqual(1);
  });
});
