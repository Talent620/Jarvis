import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { scanRepository, buildRepoMap } from "../forge/repo-intel.mjs";
import { createForgeWorkspace, applySearchReplaceEdits } from "../forge/workspace.mjs";
import { createExperienceMemory } from "../forge/memory.mjs";
import { createProviderPool, detectHardwareProfile, isAllowedByCostPolicy, FORGE_PROVIDERS } from "../forge/providers.mjs";
import { executeForgeRun, rollbackForgeRun, condenseWorkingMessages } from "../forge/engine.mjs";
import { createForgeServer } from "../forge/server.mjs";

import { riskOf, requiresFreshConsent, isClassified } from "../src/lib/permissions";
import { freeOnly } from "../src/lib/freeMode";

const tempDirs: string[] = [];

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-forge-test-"));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "demo-invoice-app",
    version: "1.0.0",
    type: "module",
    scripts: { test: "node --test" },
  }, null, 2));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "Nie zmieniaj testów po to, by przeszły. Cel ES2019 / Chrome 79 bez lookbehind.\n");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "tax.mjs"), [
    "export function applyVat(netAmount, vatRate = 0.23) {",
    "  return Math.round(netAmount * (1 + vatRate) * 100) / 100;",
    "}",
    "",
  ].join("\n"));
  // Celowy błąd w invoice.mjs: zamiast odejmować rabat, dodaje go (+ discount zamiast - discount)
  fs.writeFileSync(path.join(dir, "src", "invoice.mjs"), [
    'import { applyVat } from "./tax.mjs";',
    "",
    "export function computeInvoiceTotal(subtotal, discountPct = 0, vatRate = 0.23) {",
    "  const discounted = subtotal * (1 + discountPct / 100);",
    "  return applyVat(discounted, vatRate);",
    "}",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "invoice.test.mjs"), [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { computeInvoiceTotal } from "./src/invoice.mjs";',
    "",
    'test("computeInvoiceTotal applies percentage discount before VAT", () => {',
    "  // 200 PLN - 10% rabatu = 180 PLN; + 23% VAT = 221.40 PLN",
    "  assert.equal(computeInvoiceTotal(200, 10, 0.23), 221.4);",
    "});",
    "",
    'test("computeInvoiceTotal handles 0% discount", () => {',
    "  assert.equal(computeInvoiceTotal(200, 0, 0.23), 246);",
    "});",
    "",
  ].join("\n"));

  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "forge-test@local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Forge Test"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "initial buggy invoice"], { cwd: dir });
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const d = tempDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("JARVIS FORGE — rdzeń, bezpieczeństwo i pełny pionowy wycinek autonomiczny", () => {
  it("1. Core fixes: klasyfikacja RISK dla system_* i blokada płatnego OpenRoutera w freeOnly", () => {
    expect(isClassified("system_files_read")).toBe(true);
    expect(riskOf("system_files_read")).toBe("read");
    expect(riskOf("system_files_list")).toBe("read");
    expect(riskOf("system_workspace_status")).toBe("read");
    expect(riskOf("system_files_write")).toBe("write");
    expect(riskOf("system_terminal")).toBe("outbound");
    expect(requiresFreshConsent("system_generate_tool")).toBe(true);

    const filtered = freeOnly([
      { provider: "openrouter", model: "meta-llama/llama-3.1-405b-instruct" },
      { provider: "openrouter", model: "deepseek/deepseek-chat-v3-0324:free" },
      { provider: "anthropic", model: "claude-opus-4-8" },
      { provider: "gemini", model: "gemini-2.5-flash" },
    ]);
    expect(filtered.map((x) => `${x.provider}:${x.model}`)).toEqual([
      "openrouter:deepseek/deepseek-chat-v3-0324:free",
      "gemini:gemini-2.5-flash",
    ]);
  });

  it("2. Repo Intel: skanuje graf zależności, wykrywa komendy testowe i buduje kompaktową Repo Map", () => {
    const repo = makeTempRepo();
    const index = scanRepository(repo);
    expect(index.totalFiles).toBeGreaterThanOrEqual(4);
    expect(index.edgeCount).toBeGreaterThanOrEqual(2);
    expect(index.profile.testCommands.map((c: { label: string }) => c.label)).toContain("npm test");
    expect(index.profile.projectRules.length).toBeGreaterThanOrEqual(2);

    const taxNode = index.files.find((f: { path: string }) => f.path === "src/tax.mjs");
    expect(taxNode?.importedBy).toContain("src/invoice.mjs");

    const map = buildRepoMap(index, { query: "invoice discount VAT", maxChars: 2500 });
    expect(map.text.length).toBeLessThanOrEqual(2600);
    expect(map.includedFiles).toContain("src/invoice.mjs");
    expect(map.includedFiles).toContain("src/tax.mjs");
  });

  it("3. ACI Workspace: SEARCH/REPLACE, syntax-check, skan sekretów, granica katalogu i 100% rollback", async () => {
    const repo = makeTempRepo();
    const ws = createForgeWorkspace({ repoRoot: repo, runId: "test-aci-1" });

    // Blokada wyjścia poza katalog
    const escapeRes = await ws.executeTool("read_file", { path: "../../etc/passwd" });
    expect(escapeRes.ok).toBe(false);
    expect(String(escapeRes.error)).toMatch(/poza katalog/);

    // Blokada zapisu sekretu
    const secretRes = await ws.executeTool("write_file", {
      path: "src/leak.mjs",
      content: 'export const k = "sk-or-v1-1234567890abcdef1234567890";\n',
    });
    expect(secretRes.ok).toBe(false);
    expect(String(secretRes.error)).toMatch(/sekret/i);
    expect(fs.existsSync(path.join(repo, "src", "leak.mjs"))).toBe(false);

    // Blokada destrukcyjnych komend, ale legalny git log --format przechodzi
    const blockedGit = await ws.executeTool("run_command", { command: "git", args: ["reset", "--hard"] });
    expect(blockedGit.ok).toBe(false);
    const okGit = await ws.executeTool("run_command", { command: "git", args: ["log", "-1", "--format=%s"] });
    expect(okGit.ok).toBe(true);
    expect(String(okGit.output)).toContain("initial buggy invoice");

    // Syntax check wykrywa zepsuty JS przy edycji
    const brokenEdit = await ws.executeTool("edit_file", {
      path: "src/tax.mjs",
      search: "return Math.round(netAmount * (1 + vatRate) * 100) / 100;",
      replace: "return Math.round(netAmount * ((1 + vatRate;",
    });
    expect(brokenEdit.ok).toBe(false);
    expect(brokenEdit.syntax?.ok).toBe(false);

    // Nowy plik + rollback przywraca wszystko 1:1
    await ws.executeTool("write_file", { path: "src/temp-helper.mjs", content: "export const x = 1;\n" });
    expect(fs.existsSync(path.join(repo, "src", "temp-helper.mjs"))).toBe(true);

    const rolled = ws.rollbackRun();
    expect(rolled.ok).toBe(true);
    expect(rolled.restoredCount).toBe(2);
    expect(fs.existsSync(path.join(repo, "src", "temp-helper.mjs"))).toBe(false);
    expect(fs.readFileSync(path.join(repo, "src", "tax.mjs"), "utf8")).toContain("Math.round(netAmount * (1 + vatRate) * 100) / 100");
    expect(() => applySearchReplaceEdits("abc", [{ search: "missing", replace: "x" }])).toThrow(/nie znaleziono/);
  });

  it("4. Free-First Provider Mesh: gwarancja 0 USD, realny HTTP 429 Retry-After failover i cross-model review", async () => {
    // Polityka zero_cost blokuje płatne i kredytowe
    expect(isAllowedByCostPolicy(FORGE_PROVIDERS.anthropic, "claude-sonnet-4-6", "zero_cost").ok).toBe(false);
    expect(isAllowedByCostPolicy(FORGE_PROVIDERS.modal, "Qwen/Qwen3-32B-AWQ", "zero_cost").ok).toBe(false);
    expect(isAllowedByCostPolicy(FORGE_PROVIDERS.huggingface, "Qwen/Qwen2.5-Coder-32B-Instruct", "zero_cost").ok).toBe(false);
    expect(isAllowedByCostPolicy(FORGE_PROVIDERS.openrouter, "meta-llama/llama-3.1-405b-instruct", "zero_cost").ok).toBe(false);
    expect(isAllowedByCostPolicy(FORGE_PROVIDERS.openrouter, "deepseek/deepseek-chat-v3-0324:free", "zero_cost").ok).toBe(true);
    expect(isAllowedByCostPolicy(FORGE_PROVIDERS.cerebras, "qwen-3-32b", "zero_cost").ok).toBe(true);
    expect(isAllowedByCostPolicy(FORGE_PROVIDERS.ollama, "qwen2.5-coder:3b", "zero_cost").ok).toBe(true);

    const hw = detectHardwareProfile();
    expect(hw.cpuCores).toBeGreaterThanOrEqual(1);
    expect(hw.totalRamGb).toBeGreaterThan(0);

    // Żywy serwer HTTP: /primary zwraca 429 Retry-After: 5, /backup odpowiada poprawnym OpenAI tool_call!
    let primaryHits = 0;
    let backupHits = 0;
    const mockSrv = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        if (req.url === "/primary") {
          primaryHits += 1;
          res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "10" });
          res.end(JSON.stringify({ error: { message: "Rate limit exceeded" } }));
          return;
        }
        backupHits += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: "ok-from-backup",
              tool_calls: [{ id: "tc_1", type: "function", function: { name: "read_file", arguments: '{"path":"src/invoice.mjs"}' } }],
            },
          }],
          usage: { prompt_tokens: 42, completion_tokens: 18 },
        }));
      });
    });

    await new Promise<void>((resolve) => mockSrv.listen(0, "127.0.0.1", () => resolve()));
    const addr = mockSrv.address() as { port: number };
    try {
      const repo = makeTempRepo();
      const mem = createExperienceMemory(repo);
      const pool = createProviderPool({
        env: {},
        memory: mem,
        customProviders: {
          free_primary: {
            id: "free_primary",
            label: "Primary HTTP Free",
            costTier: "free_api",
            protocol: "openai",
            endpoint: `http://127.0.0.1:${addr.port}/primary`,
            requiresKey: true,
            envKeys: [],
            roleModels: { architect: "m1", developer: "m1", debugger: "m1", reviewer: "m1" },
            rolePriority: { architect: 99, developer: 99, debugger: 99, reviewer: 99 },
          },
          free_backup: {
            id: "free_backup",
            label: "Backup HTTP Free",
            costTier: "free_api",
            protocol: "openai",
            endpoint: `http://127.0.0.1:${addr.port}/backup`,
            requiresKey: true,
            envKeys: [],
            roleModels: { architect: "m2", developer: "m2", debugger: "m2", reviewer: "m2" },
            rolePriority: { architect: 85, developer: 85, debugger: 85, reviewer: 85 },
          },
        },
        runtimeKeys: { free_primary: "demo-key-1", free_backup: "demo-key-2" },
      });

      const res = await pool.invokeForRole("developer", {
        system: "sys",
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        costPolicy: "zero_cost",
      });
      expect(primaryHits).toBe(1);
      expect(backupHits).toBe(1);
      expect(res.provider).toBe("free_backup");
      expect(res.toolCalls[0]?.name).toBe("read_file");
      expect(res.estimatedCostUsd).toBe(0);

      // Ponowne wywołanie natychmiast pomija free_primary (w cooldown po Retry-After: 10!)
      const res2 = await pool.invokeForRole("developer", {
        system: "sys",
        messages: [{ role: "user", content: "second" }],
        tools: [],
        costPolicy: "zero_cost",
      });
      expect(primaryHits).toBe(1);
      expect(backupHits).toBe(2);
      expect(res2.provider).toBe("free_backup");
    } finally {
      await new Promise<void>((resolve) => mockSrv.close(() => resolve()));
    }
  });

  it("5. Pełny autonomiczny przebieg E2E: cel -> plan -> błędna edycja -> FAIL testów -> debug+pivot -> naprawa -> PASS -> cross-model review -> pamięć doświadczeń", async () => {
    const repo = makeTempRepo();
    const memory = createExperienceMemory(repo);
    const pool = createProviderPool({ env: {}, memory });

    let devStep = 0;
    const reviewerUsed: string[] = [];

    // Dostawca 1: Architect + Developer + Debugger
    pool.registerCustomProvider("forge_dev_free", {
      label: "Dev Coder (Free)",
      costTier: "free_api",
      rolePriority: { architect: 98, developer: 98, debugger: 98, reviewer: 80 },
      invoke: async ({ role }: { role: string }) => {
        if (role === "architect") {
          return {
            content: JSON.stringify({
              summary: "Naprawa formuły rabatu w src/invoice.mjs przed naliczeniem VAT.",
              steps: [
                { id: "s1", title: "Odczytaj src/invoice.mjs i test", role: "developer" },
                { id: "s2", title: "Popraw obliczanie rabatu w computeInvoiceTotal", role: "developer" },
                { id: "s3", title: "Zweryfikuj pakietem npm test", role: "verifier" },
                { id: "s4", title: "Przeprowadź niezależny przegląd diffu", role: "reviewer" },
              ],
              verifyCommands: [{ command: "npm", args: ["test"] }],
              decisionNote: "Rabat odejmowany od kwoty netto przed przekazaniem do applyVat.",
            }),
            toolCalls: [],
            usage: { inputTokens: 200, outputTokens: 120 },
          };
        }
        devStep += 1;
        if (devStep === 1) {
          return { content: "", toolCalls: [{ id: "t1", name: "read_file", arguments: { path: "src/invoice.mjs" } }], usage: { inputTokens: 150, outputTokens: 30 } };
        }
        if (devStep === 2) {
          // Celowo pierwsza nieudana próba (błąd 10% -> 100 zamiast /100) — Verifier MUSI ją odrzucić!
          return {
            content: "",
            toolCalls: [{
              id: "t2",
              name: "edit_file",
              arguments: {
                path: "src/invoice.mjs",
                search: "const discounted = subtotal * (1 + discountPct / 100);",
                replace: "const discounted = subtotal - discountPct;",
              },
            }],
            usage: { inputTokens: 180, outputTokens: 50 },
          };
        }
        if (devStep === 3) {
          return {
            content: "",
            toolCalls: [{ id: "t3", name: "finish_task", arguments: { summary: "Pierwsza próba poprawki rabatu" } }],
            usage: { inputTokens: 160, outputTokens: 25 },
          };
        }
        // Po realnym błędzie testów (Debugger): właściwa poprawka procentowa!
        if (devStep === 4) {
          return {
            content: "",
            toolCalls: [{
              id: "t4",
              name: "edit_file",
              arguments: {
                path: "src/invoice.mjs",
                search: "const discounted = subtotal - discountPct;",
                replace: "const discounted = subtotal * (1 - discountPct / 100);",
              },
            }],
            usage: { inputTokens: 220, outputTokens: 60 },
          };
        }
        return {
          content: "",
          toolCalls: [{ id: "t5", name: "finish_task", arguments: { summary: "Naprawiono formułę rabatu procentowego" } }],
          usage: { inputTokens: 150, outputTokens: 25 },
        };
      },
    });

    // Dostawca 2: Niezależny Reviewer (cross-model!)
    pool.registerCustomProvider("forge_reviewer_free", {
      label: "Independent Reviewer (Free)",
      costTier: "free_api",
      rolePriority: { architect: 70, developer: 70, debugger: 70, reviewer: 95 },
      invoke: async ({ role }: { role: string }) => {
        reviewerUsed.push(role);
        return {
          content: JSON.stringify({
            approved: true,
            summary: "Zmiana minimalna, czytelna i potwierdzona testami node --test.",
            issues: [],
          }),
          toolCalls: [],
          usage: { inputTokens: 180, outputTokens: 45 },
        };
      },
    });

    const events: string[] = [];
    const run = await executeForgeRun({
      goal: "Napraw błąd naliczania rabatu w computeInvoiceTotal i potwierdź testami",
      repoRoot: repo,
      providerPool: pool,
      costPolicy: "zero_cost",
      onEvent: (ev: { type: string }) => events.push(ev.type),
    });

    expect(run.status).toBe("completed");
    expect(run.progressPct).toBe(100);
    expect(run.repairCycle).toBe(1);
    expect(run.modifiedFiles.map((f: { path: string }) => f.path)).toContain("src/invoice.mjs");
    // Faktycznie przeszedł realny npm test na końcu (po wcześniejszym FAIL!)
    expect(run.testResults[0]?.ok).toBe(true);
    expect(run.testResults.some((t: { ok: boolean }) => t.ok === false)).toBe(true);
    // I faktycznie użył niezależnego Reviewera!
    expect(run.review?.approved).toBe(true);
    expect(run.review?.reviewer).toContain("forge_reviewer_free");
    expect(reviewerUsed).toEqual(["reviewer"]);
    // Plik na dysku ma poprawną implementację
    expect(fs.readFileSync(path.join(repo, "src", "invoice.mjs"), "utf8")).toContain("1 - discountPct / 100");
    // Pamięć doświadczeń zapisała zweryfikowaną lekcję FAIL->PASS, decyzję, historię i skuteczność modeli!
    const snap = createExperienceMemory(repo).getSnapshot();
    expect(snap.lessons.length).toBeGreaterThanOrEqual(1);
    expect(snap.failedAttempts.length).toBeGreaterThanOrEqual(1);
    expect(snap.decisions.length).toBeGreaterThanOrEqual(1);
    expect(snap.taskHistory[0]?.status).toBe("completed");
    expect(Object.keys(snap.modelStats).length).toBeGreaterThanOrEqual(2);
    expect(events).toContain("plan_ready");
    expect(events).toContain("debug_pivot");
    expect(events).toContain("completed");
  });

  it("6. Anty-halucynacja (uczciwe BLOCKED), Strategy Pivot, Pauza/Wznowienie z checkpointu i Context Condenser", async () => {
    const repo = makeTempRepo();
    const memory = createExperienceMemory(repo);
    const pool = createProviderPool({ env: {}, memory });

    // Agent, który zawsze twierdzi „Gotowe”, ale NIE naprawia błędu w invoice.mjs -> Verifier MUSI go zablokować!
    pool.registerCustomProvider("stubborn_coder", {
      label: "Stubborn Coder",
      costTier: "free_api",
      rolePriority: { architect: 90, developer: 90, debugger: 90, reviewer: 90 },
      invoke: async ({ role }: { role: string }) => {
        if (role === "architect") {
          return {
            content: JSON.stringify({
              summary: "Plan",
              steps: [{ id: "s1", title: "Napraw", role: "developer" }],
              verifyCommands: [{ command: "npm", args: ["test"] }],
            }),
            toolCalls: [],
          };
        }
        return {
          content: "Gotowe!",
          toolCalls: [{ id: "f1", name: "finish_task", arguments: { summary: "Zrobione bez poprawy" } }],
        };
      },
    });

    const blockedRun = await executeForgeRun({
      goal: "Napraw computeInvoiceTotal",
      repoRoot: repo,
      providerPool: pool,
      costPolicy: "zero_cost",
      maxRepairCycles: 2,
    });

    // NIGDY nie udaje sukcesu gdy npm test zwraca exit != 0!
    expect(blockedRun.status).toBe("blocked");
    expect(blockedRun.strategiesTried.length).toBeGreaterThanOrEqual(2);
    expect(blockedRun.problems.some((p: { strategyPivot?: string | null }) => Boolean(p.strategyPivot))).toBe(true);
    const memSnap = createExperienceMemory(repo).getSnapshot();
    expect(memSnap.failedAttempts.length).toBeGreaterThanOrEqual(2);

    // Pauza i wznowienie z checkpointu na dysku
    const pausedRun = await executeForgeRun({
      goal: "Zadanie do wstrzymania i wznowienia",
      repoRoot: repo,
      providerPool: pool,
      costPolicy: "zero_cost",
      shouldPause: () => true,
    });
    expect(pausedRun.status).toBe("paused");

    // Wznowienie z zapisanego checkpointu kontynuuje wykonanie
    const resumedRun = await executeForgeRun({
      repoRoot: repo,
      providerPool: pool,
      resumeRunId: pausedRun.id,
      costPolicy: "zero_cost",
      maxRepairCycles: 1,
    });
    expect(resumedRun.id).toBe(pausedRun.id);
    expect(resumedRun.resumedCount).toBe(1);
    const rbDirect = rollbackForgeRun({ repoRoot: repo, runId: pausedRun.id });
    expect(rbDirect.ok).toBe(true);

    // Context condenser ściska długie historie
    const longMsgs = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "tool",
      toolName: "read_file",
      content: `linia_${i}: ` + "x".repeat(2500),
    }));
    const condensed = condenseWorkingMessages(longMsgs, { maxChars: 6000, goal: "test", modifiedFiles: [] });
    expect(condensed.length).toBeLessThan(longMsgs.length);
    expect(condensed[1].content).toContain("SKONDENSOWANY STAN ROBOCZY");
  });

  it("7. Serwer HTTP/SSE Forge: ochrona /api/session, wykonanie zadania przez API i Rollback", async () => {
    const repo = makeTempRepo();
    const memory = createExperienceMemory(repo);
    const pool = createProviderPool({ env: {}, memory });
    let callIdx = 0;
    pool.registerCustomProvider("srv_coder", {
      label: "Server Coder",
      costTier: "free_api",
      rolePriority: { architect: 95, developer: 95, debugger: 95, reviewer: 95 },
      invoke: async ({ role }: { role: string }) => {
        if (role === "architect") {
          return {
            content: JSON.stringify({
              summary: "Napraw rabat",
              steps: [{ id: "s1", title: "Popraw invoice.mjs", role: "developer" }],
              verifyCommands: [{ command: "npm", args: ["test"] }],
            }),
            toolCalls: [],
          };
        }
        if (role === "reviewer") {
          return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        }
        callIdx += 1;
        if (callIdx === 1) {
          return {
            content: "",
            toolCalls: [{
              id: "e1",
              name: "edit_file",
              arguments: {
                path: "src/invoice.mjs",
                search: "const discounted = subtotal * (1 + discountPct / 100);",
                replace: "const discounted = subtotal * (1 - discountPct / 100);",
              },
            }],
          };
        }
        return { content: "", toolCalls: [{ id: "f1", name: "finish_task", arguments: { summary: "Naprawiono" } }] };
      },
    });

    const srv = createForgeServer({ defaultRepoRoot: repo, port: 0, runtimeDir: path.join(repo, ".jarvis-forge", "runtime"), providerPool: pool });
    const started = await srv.start();
    try {
      // Blokada bez X-Forge-Client i z Origin: null
      const bare = await fetch(`${started.url}/api/session`);
      expect(bare.status).toBe(403);
      const nullOrig = await fetch(`${started.url}/api/session`, { headers: { "X-Forge-Client": "jarvis-ui", Origin: "null" } });
      expect(nullOrig.status).toBe(403);

      // Zaufana sesja lokalna
      const sessRes = await fetch(`${started.url}/api/session`, { headers: { "X-Forge-Client": "jarvis-ui" } });
      expect(sessRes.status).toBe(200);
      const sess = await sessRes.json();
      expect(typeof sess.token).toBe("string");

      const authHeaders = {
        "Content-Type": "application/json",
        "X-Forge-Token": sess.token,
        "X-Forge-Client": "jarvis-ui",
      };

      // Uruchomienie zadania przez API
      const runRes = await fetch(`${started.url}/api/runs`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ goal: "Napraw rabat w invoice.mjs", repoPath: repo, wait: true }),
      });
      expect(runRes.status).toBe(200);
      const runJson = await runRes.json();
      expect(runJson.run.status).toBe("completed");
      expect(fs.readFileSync(path.join(repo, "src", "invoice.mjs"), "utf8")).toContain("1 - discountPct / 100");

      // Rollback przez API przywraca plik oryginalny
      const rbRes = await fetch(`${started.url}/api/runs/${encodeURIComponent(runJson.run.id)}/rollback`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ repoPath: repo }),
      });
      expect(rbRes.status).toBe(200);
      expect(fs.readFileSync(path.join(repo, "src", "invoice.mjs"), "utf8")).toContain("1 + discountPct / 100");

      // Odczyt pamięci doświadczeń przez API
      const memRes = await fetch(`${started.url}/api/memory?path=${encodeURIComponent(repo)}`, { headers: authHeaders });
      expect(memRes.status).toBe(200);
      const memJson = await memRes.json();
      expect(memJson.memory.taskHistory.length).toBeGreaterThanOrEqual(1);
    } finally {
      await srv.close();
    }
  });
});
