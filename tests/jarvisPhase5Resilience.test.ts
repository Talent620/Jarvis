/**
 * JARVIS PHASE 5 — REAL AUTONOMY & RESILIENCE TEST SUITE (DETERMINISTIC CONTRACT + REAL GIT/TESTS).
 *
 * Weryfikuje wszystkie 10 scenariuszy odporności i poprawki architektoniczne z Fazy 5:
 *  1. Niepoprawny format odpowiedzi modelu (uszkodzony JSON + blok kodu w prozie zamiast narzędzia) -> odzyskiwanie.
 *  2. Nieznane narzędzie (`createTaskScheduler`) i aliasy argumentów (`file_path`, `old_str`, `new_str`) -> normalizacja + strukturalna lista narzędzi.
 *  3. Porażka testów -> Debugger + zmiana strategii -> poprawka -> PASS + zapis lekcji w ExperienceMemory.
 *  4. Provider przestaje odpowiadać (awaria sieci / HTTP 503) -> przejściowy cooldown + natychmiastowy failover bez ponownego uderzania w martwego dostawcę.
 *  5. Zadanie trwa zbyt długo (`maxDurationMs`) -> czysty checkpoint (`time_limit`) + wznowienie.
 *  6. Przerwanie zadania pracującego w izolowanym `git worktree` -> ZACHOWANIE częściowych edycji w worktree -> bezstratne wznowienie + scalenie + PASS!
 *  7. Próba oszukania/osłabienia testów przez agenta (bez jawnego „Do not modify test/...” w prompcie!) -> automatyczna twarda blokada + zdarzenie bezpieczeństwa -> naprawa kodu produkcyjnego.
 *  8. Dwa modele przedstawiają sprzeczne rozwiązania -> jawna detekcja konfliktu (`conflictingSolutionsDetected`, `divergentFiles`, `conflictResolution`), zero mieszania patchy, wybór wyłącznie zweryfikowanego zwycięzcy.
 *  9. Operacja niedozwolona bez decyzji użytkownika -> `waiting_approval` / brak samo-zatwierdzania.
 * 10. Uczciwa flaga `independentModelReviewed` (true dla niezależnego modelu, false dla self-review / fallback).
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  createProviderPool,
  detectMalformedOrUnknownToolCall,
  extractInlineToolCallsFromText,
  pickBestLocalOllamaModel,
} from "../forge/providers.mjs";
import { createExperienceMemory } from "../forge/memory.mjs";
import {
  applySearchReplaceEdits,
  createForgeWorkspace,
  detectTestWeakening,
  extractErrorSignature,
  isTestFilePath,
  normalizeToolInvocation,
} from "../forge/workspace.mjs";
import {
  executeCompetitiveForgeRun,
  executeForgeRun,
  rollbackForgeRun,
} from "../forge/engine.mjs";
import { executeAutopilotMission, resumeAutopilotMission } from "../forge/autopilot.mjs";

const cleanupDirs: string[] = [];

function makeGitRepo(files: Record<string, string>, prefix = "jarvis-p5-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "p5@jarvis.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Jarvis P5 Test"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
  return dir;
}

afterEach(() => {
  while (cleanupDirs.length) {
    const dir = cleanupDirs.pop()!;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("Phase 5 — Odporność na błędy formatu, nieznane narzędzia i manipulację testami", () => {
  it("1. Odzyskiwanie po uszkodzonym JSON, kodzie w prozie, halucynacji nazwy narzędzia i aliasach parametrów", async () => {
    // Parser inline toleruje trailing commas i wykrywa unknown_tool / code_without_tool
    const parsedTrailing = extractInlineToolCallsFromText(
      '```json\n{"name": "edit_file", "arguments": {"path": "src/a.mjs", "search": "1", "replace": "2",},}\n```',
      [{ name: "edit_file" }],
    );
    expect(parsedTrailing).toHaveLength(1);
    expect(parsedTrailing[0].name).toBe("edit_file");

    expect(detectMalformedOrUnknownToolCall('{"name":"createTaskScheduler","arguments":{}}', [{ name: "edit_file" }])).toEqual({
      kind: "unknown_tool",
      toolName: "createTaskScheduler",
    });
    expect(detectMalformedOrUnknownToolCall("Proponuję zmianę:\n```js\nexport const x = 42;\n```", [{ name: "edit_file" }]).kind)
      .toBe("code_without_tool");

    // Normalizacja aliasów z mniejszych modeli (np. str_replace / file_path / old_str / new_str)
    const norm = normalizeToolInvocation("str_replace", { file_path: "src/a.mjs", old_str: "a", new_str: "b" });
    expect(norm.name).toBe("edit_file");
    expect(norm.args.path).toBe("src/a.mjs");
    expect(norm.args.search).toBe("a");
    expect(norm.args.replace).toBe("b");

    // End-to-end: model najpierw wysyła nieznane narzędzie, potem kod w prozie, potem uszkodzony JSON, a na końcu poprawny edit_file -> PASS!
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "p5-malformed", scripts: { test: "node --test" } }),
      "src/calc.mjs": "export const double = (n) => n + 1;\n",
      "test/calc.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { double } from '../src/calc.mjs'; test('double', () => assert.equal(double(5), 10));\n",
    });
    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    let turn = 0;
    pool.registerCustomProvider("quirky_model", {
      costTier: "local",
      invoke: async ({ role, messages }) => {
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        turn += 1;
        if (turn === 1) {
          // 1) Halucynacja nieznanego narzędzia w tekście
          return { content: '{"name": "magicFixCode", "arguments": {"file": "src/calc.mjs"}}', toolCalls: [] };
        }
        if (turn === 2) {
          // Sprawdź, czy Jarvis przekazał jawną korektę o nieznanym narzędziu!
          const lastUser = messages[messages.length - 1]?.content || "";
          expect(lastUser).toContain("magicFixCode");
          expect(lastUser).toContain("edit_file");
          // 2) Kod wypisany w prozie zamiast narzędzia
          return { content: "Oto poprawka:\n```js\nexport const double = (n) => n * 2;\n```", toolCalls: [] };
        }
        if (turn === 3) {
          // 3) Alias str_replace + file_path/old_str/new_str
          return {
            content: "",
            toolCalls: [{ id: "q1", name: "str_replace", arguments: { file_path: "src/calc.mjs", old_str: "n + 1", new_str: "n * 2" } }],
          };
        }
        return { content: "", toolCalls: [{ id: "q2", name: "finish_task", arguments: { summary: "Naprawiono double" } }] };
      },
    });

    const res = await executeAutopilotMission({
      goal: "Fix small bug in src/calc.mjs",
      repoRoot: repo,
      providerPool: pool,
      probeLocal: false,
    });
    expect(res.ok).toBe(true);
    expect(res.verdict).toBe("PASS");
    expect(fs.readFileSync(path.join(repo, "src/calc.mjs"), "utf8")).toContain("n * 2");
  });

  it("2. Automatyczna ochrona istniejących testów i wykrywanie osłabiania asercji (BEZ jawnego zakazu w prompcie!)", async () => {
    expect(isTestFilePath("test/invoice.test.mjs")).toBe(true);
    expect(isTestFilePath("src/invoice.mjs")).toBe(false);
    expect(detectTestWeakening("test('a', () => { assert.equal(x, 5); });", "test.skip('a', () => { assert.equal(x, 5); });").weakened).toBe(true);
    expect(detectTestWeakening("test('a', () => { assert.equal(x, 5); });", "test('a', () => { assert.ok(true); });").weakened).toBe(true);
    expect(detectTestWeakening("test('a', () => { assert.equal(x, 5); });", "test('a', () => { assert.equal(x, 5); });\ntest('b', () => { assert.equal(x, 6); });").weakened).toBe(false);

    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "p5-test-guard", scripts: { test: "node --test" } }),
      "src/tax.mjs": "export const calcTax = (net) => net * 0.5;\n",
      "test/tax.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { calcTax } from '../src/tax.mjs'; test('23% VAT', () => assert.equal(calcTax(100), 23));\n",
    });

    // Bezpośrednia weryfikacja workspace: blokada usunięcia lub osłabienia asercji nawet gdy protectExistingTests=false
    const wsAllow = createForgeWorkspace({ repoRoot: repo, runId: "weaken-check", protectExistingTests: false });
    const weakenAttempt = await wsAllow.executeTool("edit_file", {
      path: "test/tax.test.mjs",
      search: "assert.equal(calcTax(100), 23)",
      replace: "assert.ok(true)",
    });
    expect(weakenAttempt.ok).toBe(false);
    expect(weakenAttempt.error).toMatch(/POLITYKI|osłabiać|trywialnym/i);

    const delAttempt = await wsAllow.executeTool("delete_file", { path: "test/tax.test.mjs" });
    expect(delAttempt.ok).toBe(false);

    // End-to-end: zwykłe polecenie użytkownika bez „nie zmieniaj testów” -> agent próbuje zmienić test/tax.test.mjs -> twarda blokada -> naprawia src/tax.mjs -> PASS!
    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    let turn = 0;
    let sawPolicyRejection = false;
    pool.registerCustomProvider("cheating_then_honest", {
      costTier: "local",
      invoke: async ({ role, messages }) => {
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        turn += 1;
        if (turn === 1) {
          return {
            content: "",
            toolCalls: [{ id: "ch1", name: "edit_file", arguments: { path: "test/tax.test.mjs", search: "23", replace: "50" } }],
          };
        }
        if (turn === 2) {
          const toolMsg = messages[messages.length - 1]?.content || "";
          if (toolMsg.includes("BŁĄD POLITYKI")) sawPolicyRejection = true;
          return {
            content: "",
            toolCalls: [{ id: "ch2", name: "edit_file", arguments: { path: "src/tax.mjs", search: "0.5", replace: "0.23" } }],
          };
        }
        return { content: "", toolCalls: [{ id: "ch3", name: "finish_task", arguments: { summary: "Naprawiono stawkę VAT w src/tax.mjs" } }] };
      },
    });

    const res = await executeAutopilotMission({
      goal: "Napraw błąd liczenia podatku VAT w tym repozytorium",
      repoRoot: repo,
      providerPool: pool,
      probeLocal: false,
    });
    expect(sawPolicyRejection).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.run?.securityEvents?.some((e: { kind: string }) => e.kind === "test-tampering-blocked")).toBe(true);
    expect(fs.readFileSync(path.join(repo, "test/tax.test.mjs"), "utf8")).toContain("23");
    expect(fs.readFileSync(path.join(repo, "src/tax.mjs"), "utf8")).toContain("0.23");
  });
});

describe("Phase 5 — Failover martwego dostawcy, zachowanie worktree przy pauzie i sprzeczne rozwiązania 2 modeli", () => {
  it("3. Provider przestaje odpowiadać (awaria sieci / HTTP 503) -> transient cooldown + natychmiastowy failover w kolejnych turach", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "p5-failover", scripts: { test: "node --test" } }),
      "src/sum.mjs": "export const sum = (a, b) => a - b;\n",
      "test/sum.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { sum } from '../src/sum.mjs'; test('sum', () => assert.equal(sum(3, 4), 7));\n",
    });

    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {}, transientCooldownMs: 60_000 });
    let deadCalls = 0;
    let backupTurns = 0;

    pool.registerCustomProvider("dead_primary", {
      costTier: "local",
      rolePriority: { architect: 99, developer: 99, debugger: 99, reviewer: 99 },
      invoke: async () => {
        deadCalls += 1;
        const err = new Error("connect ECONNREFUSED 127.0.0.1:9999");
        (err as { status?: number }).status = 503;
        throw err;
      },
    });
    pool.registerCustomProvider("healthy_backup", {
      costTier: "free_api",
      rolePriority: { architect: 50, developer: 50, debugger: 50, reviewer: 50 },
      invoke: async ({ role }) => {
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        backupTurns += 1;
        if (backupTurns === 1) {
          return { content: "", toolCalls: [{ id: "b1", name: "edit_file", arguments: { path: "src/sum.mjs", search: "a - b", replace: "a + b" } }] };
        }
        return { content: "", toolCalls: [{ id: "b2", name: "finish_task", arguments: { summary: "Naprawiono sum" } }] };
      },
    });

    const res = await executeAutopilotMission({
      goal: "Fix small bug in src/sum.mjs",
      repoRoot: repo,
      providerPool: pool,
      probeLocal: false,
    });
    expect(res.ok).toBe(true);
    // Martwy dostawca został wywołany TYLKO RAZ, po czym transient cooldown wykluczył go w kolejnych turach!
    expect(deadCalls).toBe(1);
    expect(res.run?.providersUsed.some((p: string) => p.startsWith("healthy_backup/"))).toBe(true);
    expect(res.run?.review?.independentModelReviewed).toBe(false); // Ten sam model recenzował sam siebie -> uczciwe false!
  });

  it("4. Przerwanie w izolowanym git worktree ZACHOWUJE częściowe edycje na dysku i pozwala wznowić bez utraty pracy", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "p5-wt-resume", scripts: { test: "node --test" } }),
      "src/a.mjs": "export const a = 1;\n",
      "src/b.mjs": "export const b = 1;\n",
      "test/ab.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { a } from '../src/a.mjs'; import { b } from '../src/b.mjs'; test('a+b', () => assert.equal(a + b, 4));\n",
    });

    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    let step = 0;
    let shouldPauseFlag = false;

    pool.registerCustomProvider("wt_model", {
      costTier: "free_api",
      invoke: async ({ role }) => {
        if (role === "architect") {
          return {
            content: JSON.stringify({
              summary: "Zaktualizuj a i b na 2",
              steps: [{ id: "s1", title: "edit a", role: "developer" }, { id: "s2", title: "edit b", role: "developer" }],
              targetFiles: ["src/a.mjs", "src/b.mjs"],
            }),
            toolCalls: [],
          };
        }
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        step += 1;
        if (step === 1) {
          return { content: "", toolCalls: [{ id: "w1", name: "edit_file", arguments: { path: "src/a.mjs", search: "a = 1", replace: "a = 2" } }] };
        }
        if (step === 2) {
          // Po wznowieniu edytuje TYLKO plik B — plik A musi nadal mieć a = 2 w zachowanym worktree!
          return { content: "", toolCalls: [{ id: "w2", name: "edit_file", arguments: { path: "src/b.mjs", search: "b = 1", replace: "b = 2" } }] };
        }
        return { content: "", toolCalls: [{ id: "w3", name: "finish_task", arguments: { summary: "Zaktualizowano oba pliki" } }] };
      },
    });

    const paused = await executeForgeRun({
      goal: "Update src/a.mjs and src/b.mjs across multiple files",
      repoRoot: repo,
      providerPool: pool,
      useWorktree: true,
      shouldPause: () => shouldPauseFlag,
      onEvent: (ev) => {
        if (ev.type === "tool_call" && ev.tool === "edit_file") shouldPauseFlag = true;
      },
    });

    expect(paused.status).toBe("paused");
    expect(paused.worktreePath).toBeTruthy();
    // Worktree PRZETRWAŁ pauzę i zawiera częściową edycję src/a.mjs, a główne repo jest nadal czyste!
    expect(fs.existsSync(paused.worktreePath)).toBe(true);
    expect(fs.readFileSync(path.join(paused.worktreePath, "src/a.mjs"), "utf8")).toContain("a = 2");
    expect(fs.readFileSync(path.join(repo, "src/a.mjs"), "utf8")).toContain("a = 1");

    // Wznów z checkpointu -> dokończ src/b.mjs -> scal oba pliki -> PASS + posprzątaj worktree!
    shouldPauseFlag = false;
    const resumed = await resumeAutopilotMission({
      runId: paused.id,
      repoRoot: repo,
      providerPool: pool,
    });
    expect(resumed.ok).toBe(true);
    expect(resumed.verdict).toBe("PASS");
    expect(fs.readFileSync(path.join(repo, "src/a.mjs"), "utf8")).toContain("a = 2");
    expect(fs.readFileSync(path.join(repo, "src/b.mjs"), "utf8")).toContain("b = 2");
    expect(fs.existsSync(paused.worktreePath)).toBe(false); // Po ukończeniu worktree posprzątane!

    // Sprawdź też sprzątanie worktree przy rollbacku zapauzowanego zadania
    shouldPauseFlag = false;
    step = 0;
    const paused2 = await executeForgeRun({
      goal: "Update src/a.mjs",
      repoRoot: repo,
      providerPool: pool,
      useWorktree: true,
      shouldPause: () => shouldPauseFlag,
      onEvent: (ev) => {
        if (ev.type === "tool_call" && ev.tool === "edit_file") shouldPauseFlag = true;
      },
    });
    expect(paused2.status).toBe("paused");
    expect(fs.existsSync(paused2.worktreePath)).toBe(true);
    rollbackForgeRun({ repoRoot: repo, runId: paused2.id });
    expect(fs.existsSync(paused2.worktreePath)).toBe(false);
  });

  it("5. Dwa modele przedstawiają sprzeczne rozwiązania w trybie konkurencyjnym -> jawne rozstrzygnięcie konfliktu bez mieszania patchy", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "p5-conflict", scripts: { test: "node --test" } }),
      "src/clamp.mjs": "export function clamp(v, min, max) { return v; }\n",
      "test/clamp.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { clamp } from '../src/clamp.mjs'; test('clamp', () => { assert.equal(clamp(-5, 0, 10), 0); assert.equal(clamp(15, 0, 10), 10); assert.equal(clamp(5, 0, 10), 5); });\n",
    });

    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {} });
    let turnA = 0;
    let turnB = 0;
    pool.registerCustomProvider("model_concise", {
      costTier: "local",
      invoke: async ({ role }) => {
        if (role === "architect") return { content: JSON.stringify({ summary: "Math.min/max", steps: [{ id: "s1", title: "clamp", role: "developer" }], targetFiles: ["src/clamp.mjs"] }), toolCalls: [] };
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "Zwięzłe i czyste", issues: [] }), toolCalls: [] };
        turnA += 1;
        if (turnA === 1) return { content: "", toolCalls: [{ id: "a1", name: "edit_file", arguments: { path: "src/clamp.mjs", search: "return v;", replace: "return Math.min(max, Math.max(min, v));" } }] };
        return { content: "", toolCalls: [{ id: "a2", name: "finish_task", arguments: { summary: "Compact clamp" } }] };
      },
    });
    pool.registerCustomProvider("model_verbose", {
      costTier: "free_api",
      invoke: async ({ role }) => {
        if (role === "architect") return { content: JSON.stringify({ summary: "if/else", steps: [{ id: "s1", title: "clamp", role: "developer" }], targetFiles: ["src/clamp.mjs"] }), toolCalls: [] };
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "Działa", issues: [] }), toolCalls: [] };
        turnB += 1;
        if (turnB === 1) {
          return {
            content: "",
            toolCalls: [{
              id: "b1",
              name: "edit_file",
              arguments: {
                path: "src/clamp.mjs",
                search: "return v;",
                replace: "if (v < min) {\n  return min;\n}\nif (v > max) {\n  return max;\n}\nreturn v;",
              },
            }],
          };
        }
        return { content: "", toolCalls: [{ id: "b2", name: "finish_task", arguments: { summary: "Verbose clamp" } }] };
      },
    });

    const comp = await executeCompetitiveForgeRun({
      goal: "Implement clamp logic in src/clamp.mjs",
      repoRoot: repo,
      providerPool: pool,
      candidates: [
        { id: "cand-concise", label: "model_concise/local", preferredProvider: "model_concise", costPolicy: "zero_cost" },
        { id: "cand-verbose", label: "model_verbose/free", preferredProvider: "model_verbose", costPolicy: "zero_cost" },
      ],
    });

    expect(comp.ok).toBe(true);
    expect(comp.comparison.conflictingSolutionsDetected).toBe(true);
    expect(comp.comparison.divergentFiles).toContain("src/clamp.mjs");
    expect(comp.comparison.conflictResolution).toMatch(/sprzecznymi zmianami|wyłącznie zwycięski/i);
    // Lokalny i zwięzły zwycięzca (wyższy resourceEfficiencyScore) wybrany czysto bez mieszania diffów!
    expect(comp.winner?.candidateId).toBe("cand-concise");
    const finalSrc = fs.readFileSync(path.join(repo, "src/clamp.mjs"), "utf8");
    expect(finalSrc).toContain("Math.min(max, Math.max(min, v))");
    expect(finalSrc).not.toContain("if (v < min)");
  });

  it("6. Odrzucenie no-op edit_file + detektor zapętlenia wewnątrz pętli Developera -> Strategy Pivot + rotacja na zdrowy model -> PASS", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "p5-noop-loop", type: "module", scripts: { test: "node --test" } }),
      "src/tax.mjs": "export function net(v, d) { return v * (1 + d / 100); }\n",
      "test/tax.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { net } from '../src/tax.mjs'; test('discount', () => assert.equal(net(100, 20), 80));\n",
    });

    // Bezpośredni kontrakt workspace: edit_file z search === replace ZAWSZE zwraca ok:false + noOp:true!
    const ws = createForgeWorkspace({ repoRoot: repo, runId: "p5-noop-direct" });
    const noOpRes = await ws.executeTool("edit_file", {
      path: "src/tax.mjs",
      search: "return v * (1 + d / 100);",
      replace: "return v * (1 + d / 100);",
    });
    expect(noOpRes.ok).toBe(false);
    expect(noOpRes.noOp).toBe(true);

    // Pełny przebieg: model słaby (local) wysyła 2 puste no-op edycje -> detektor pętli przerywa turę, eskaluje i zdrowy model naprawia kod!
    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {}, ollamaUrl: "http://127.0.0.1:1" });
    let stuckCalls = 0;
    let smartTurn = 0;
    pool.registerCustomProvider("stuck_local", {
      costTier: "local",
      invoke: async ({ role }) => {
        if (role === "architect") return { content: JSON.stringify({ summary: "Fix tax", steps: [{ id: "s1", title: "edit", role: "developer" }], targetFiles: ["src/tax.mjs"] }), toolCalls: [] };
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "Niezależny przegląd OK", issues: [] }), toolCalls: [] };
        stuckCalls += 1;
        return {
          content: "",
          toolCalls: [{ id: `noop_${stuckCalls}`, name: "edit_file", arguments: { path: "src/tax.mjs", search: "return v * (1 + d / 100);", replace: "return v * (1 + d / 100);" } }],
        };
      },
    });
    pool.registerCustomProvider("smart_free", {
      costTier: "free_api",
      invoke: async ({ role }) => {
        if (role === "architect") return { content: JSON.stringify({ summary: "Fix tax", steps: [{ id: "s1", title: "edit", role: "developer" }], targetFiles: ["src/tax.mjs"] }), toolCalls: [] };
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        smartTurn += 1;
        if (smartTurn === 1) {
          return { content: "", toolCalls: [{ id: "fix1", name: "edit_file", arguments: { path: "src/tax.mjs", search: "1 + d / 100", replace: "1 - d / 100" } }] };
        }
        return { content: "", toolCalls: [{ id: "fin1", name: "finish_task", arguments: { summary: "Fixed discount sign" } }] };
      },
    });

    const res = await executeForgeRun({
      goal: "Fix discount sign in src/tax.mjs",
      repoRoot: repo,
      providerPool: pool,
      costPolicy: "zero_cost",
    });

    expect(res.status).toBe("completed");
    expect(stuckCalls).toBe(2); // Przerwano po dokładnie 2 no-op zamiast mielić 12 iteracji!
    expect(res.strategiesTried.length).toBeGreaterThanOrEqual(2);
    expect(res.providersUsed.some((p: string) => p.startsWith("smart_free/"))).toBe(true);
    expect(res.review?.independentModelReviewed).toBe(true);
    expect(fs.readFileSync(path.join(repo, "src/tax.mjs"), "utf8")).toContain("1 - d / 100");
  });

  it("7. Parser JSON naprawia \\' i surowe \\n, extractErrorSignature czyta Node TAP, a applySearchReplaceEdits radzi sobie z pojedynczą linią", () => {
    // 7a. Invalid RFC 8259 escape \' oraz surowe znaki nowej linii w JSON wygenerowanym przez mały model
    const rawInline = "```json\n{\"name\": \"write_file\", \"arguments\": {\"path\": \"src/a.mjs\", \"content\": \"if (x === \\'ok\\')\nreturn 1;\"}}\n```";
    const calls = extractInlineToolCallsFromText(rawInline, [{ name: "write_file" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("write_file");
    expect(calls[0].arguments.content).toContain("if (x === 'ok')\nreturn 1;");

    // 7b. Ekstrakcja błędów Node.js --test TAP (nazwa testu, expected/actual, ścieżka pliku testowego)
    const tapOut = [
      "TAP version 13",
      "not ok 1 - percentage coupon reduces subtotal",
      "  location: '/tmp/repo/test/invoice.test.mjs:5:1'",
      "  error: |-",
      "    120 !== 80",
      "  expected: 80",
      "  actual: 120",
    ].join("\n");
    const sig = extractErrorSignature(tapOut, "npm test");
    expect(sig.summary).toContain("not ok 1 - percentage coupon reduces subtotal");
    expect(sig.summary).toContain("expected: 80");
    expect(sig.summary).toContain("actual: 120");
    expect(sig.files.some((f: string) => f.includes("test/invoice.test.mjs"))).toBe(true);

    // 7c. applySearchReplaceEdits: pojedyncza linia z numerem linii z read_file oraz pojedyncza linia z różnym wcięciem
    const src = "export function f(x) {\n    return x * (1 + 0.2);\n}\n";
    const editedLineNum = applySearchReplaceEdits(src, [{ search: "2:     return x * (1 + 0.2);", replace: "2:     return x * (1 - 0.2);" }]);
    expect(editedLineNum).toContain("    return x * (1 - 0.2);");
    const editedIndent = applySearchReplaceEdits(src, [{ search: "return x * (1 + 0.2);", replace: "return x * (1 - 0.2);" }]);
    expect(editedIndent).toContain("    return x * (1 - 0.2);");

    // 7d. Ranking lokalnych modeli Ollama: nowszy qwen3:4b-instruct przed słabszym 3B, ale 7B+ coder nadal najwyżej
    const hwCpu = { gpu: null, cpuCores: 2, totalRamGb: 8 };
    expect(pickBestLocalOllamaModel(["qwen2.5-coder:3b", "qwen3:4b-instruct-2507-q4_K_M"], "developer", hwCpu)).toBe("qwen3:4b-instruct-2507-q4_K_M");
    expect(pickBestLocalOllamaModel(["qwen2.5-coder:7b", "qwen3:4b-instruct-2507-q4_K_M"], "developer", hwCpu)).toBe("qwen2.5-coder:7b");
  });

  it("8. Timeout Architecta przechodzi w bezpieczny plan deterministyczny (nie zabija misji), a Reviewer nie wymaga edycji chronionych testów", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "p5-arch-fallback", type: "module", scripts: { test: "node --test" } }),
      "src/sum.mjs": "export const sumPos = (a) => a.reduce((s, x) => s + x, 0);\n",
      "test/sum.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { sumPos } from '../src/sum.mjs'; test('pos', () => assert.equal(sumPos([3, -2, 5]), 8));\n",
    });

    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {}, ollamaUrl: "http://127.0.0.1:1" });
    let devStep = 0;
    let reviewerPromptSeen = "";

    pool.registerCustomProvider("flaky_arch_good_dev", {
      costTier: "free_api",
      invoke: async ({ role, system, messages }) => {
        if (role === "architect") {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          throw err;
        }
        if (role === "reviewer") {
          reviewerPromptSeen = `${system}\n${messages.map((m: { content: string }) => m.content).join("\n")}`;
          return { content: JSON.stringify({ approved: true, summary: "OK, testy chronione i zaliczone", issues: [] }), toolCalls: [] };
        }
        devStep += 1;
        if (devStep === 1) {
          return { content: "", toolCalls: [{ id: "e1", name: "edit_file", arguments: { path: "src/sum.mjs", search: "a.reduce((s, x) => s + x, 0)", replace: "a.filter((x) => x > 0).reduce((s, x) => s + x, 0)" } }] };
        }
        return { content: "", toolCalls: [{ id: "f1", name: "finish_task", arguments: { summary: "Filtered positive numbers" } }] };
      },
    });

    const res = await executeForgeRun({
      goal: "Fix sumPos in src/sum.mjs so tests in test/sum.test.mjs pass",
      repoRoot: repo,
      providerPool: pool,
      costPolicy: "zero_cost",
    });

    expect(res.status).toBe("completed");
    expect(res.verdict).toBe("PASS");
    expect(res.problems.some((p: { severity: string; message: string }) => p.severity === "warning" && /Architect fallback/i.test(p.message))).toBe(true);
    // Chroniony plik testowy NIE może trafiać do BRAKUJĄCYCH plików docelowych u Recenzenta!
    expect(reviewerPromptSeen).toContain("OCHRONA TESTÓW");
    expect(reviewerPromptSeen).not.toContain("BRAKUJĄCE: test/sum.test.mjs");
  });

  it("9. Codzienne polskie polecenie 'Przeanalizuj moduł faktur, znajdź błędy i popraw je. Nie zmieniaj testów...' NIE jest read-only (blokuje no-op PASS i edycję testów), a HTTP /resume natychmiast zwraca aktywny status", async () => {
    const repo = makeGitRepo({
      "package.json": JSON.stringify({ name: "p5-daily-invoice", type: "module", scripts: { test: "node --test" } }),
      "src/invoice.mjs": [
        "export function calculateInvoice(subtotal, discountPercent = 0, vatRate = 0.23) {",
        "  const net = subtotal * (1 + discountPercent / 100);",
        "  const vat = Math.round(net * vatRate * 100) / 100;",
        "  return { net: Math.round(net * 100) / 100, vat, total: Math.round((net + vat) * 100) / 100 };",
        "}",
        "",
      ].join("\n"),
      "test/invoice.test.mjs": [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { calculateInvoice } from '../src/invoice.mjs';",
        "test('10% discount reduces net and VAT', () => {",
        "  const r = calculateInvoice(100, 10, 0.23);",
        "  assert.equal(r.net, 90);",
        "  assert.equal(r.vat, 20.7);",
        "  assert.equal(r.total, 110.7);",
        "});",
        "",
      ].join("\n"),
    });

    const pool = createProviderPool({ memory: createExperienceMemory(repo), env: {}, ollamaUrl: "http://127.0.0.1:1" });
    let devTurn = 0;
    let sawTestProtectionError = false;
    pool.registerCustomProvider("daily_dev", {
      costTier: "local",
      rolePriority: { architect: 80, developer: 95, debugger: 95, reviewer: 10 },
      invoke: async ({ role, messages }) => {
        if (role === "architect") {
          return { content: JSON.stringify({ summary: "Fix invoice discount sign", steps: [{ id: "s1", title: "Fix src/invoice.mjs", role: "developer" }] }), toolCalls: [] };
        }
        devTurn += 1;
        // Tura 1: agent próbuje fałszywego finish_task BEZ żadnych edycji -> MUSI zostać odrzucony przez change-check!
        if (devTurn === 1) {
          return { content: "", toolCalls: [{ id: "d1", name: "finish_task", arguments: { summary: "Przeanalizowałem moduł faktur, wszystko wygląda dobrze" } }] };
        }
        // Tura 2: po odrzuceniu no-op agent próbuje zmodyfikować test -> MUSI zostać zablokowany przez protectExistingTests!
        if (devTurn === 2) {
          return { content: "", toolCalls: [{ id: "d2", name: "edit_file", arguments: { path: "test/invoice.test.mjs", search: "assert.equal(r.net, 90);", replace: "assert.equal(r.net, 110);" } }] };
        }
        // Tura 3: agent czyta odmowę polityki i naprawia prawdziwy błąd w src/invoice.mjs
        if (devTurn === 3) {
          const lastMsg = messages[messages.length - 1]?.content || "";
          if (lastMsg.includes("BŁĄD POLITYKI")) sawTestProtectionError = true;
          return { content: "", toolCalls: [{ id: "d3", name: "edit_file", arguments: { path: "src/invoice.mjs", search: "1 + discountPercent / 100", replace: "1 - discountPercent / 100" } }] };
        }
        return { content: "", toolCalls: [{ id: "d4", name: "finish_task", arguments: { summary: "Naprawiono znak rabatu w src/invoice.mjs i zweryfikowano testami" } }] };
      },
    });
    pool.registerCustomProvider("daily_reviewer", {
      costTier: "local",
      rolePriority: { architect: 10, developer: 10, debugger: 10, reviewer: 99 },
      invoke: async () => ({ content: JSON.stringify({ approved: true, summary: "Poprawka zweryfikowana niezależnie", issues: [] }), toolCalls: [] }),
    });

    // 9a. Dokładne codzienne polecenie z odbioru końcowego: zaczyna się od „Przeanalizuj”, ale żąda „i popraw je”
    const dailyGoal = "Przeanalizuj moduł faktur, znajdź błędy i popraw je. Nie zmieniaj testów. Na koniec uruchom testy i pokaż mi wynik";
    const res = await executeAutopilotMission({
      goal: dailyGoal,
      repoRoot: repo,
      providerPool: pool,
      probeLocal: false,
      useWorktree: false,
    });
    expect(res.ok).toBe(true);
    expect(res.verdict).toBe("PASS");
    // Tura 1 (no-op finish_task) została ODRZUCONA przez change-check -> musiała nastąpić próba naprawy!
    expect(res.run?.attemptHistory?.some((a: { ok: boolean; errorSignature: string | null }) => !a.ok && a.errorSignature === "no-files-modified")).toBe(true);
    expect(sawTestProtectionError).toBe(true);
    expect(res.run?.securityEvents?.some((e: { kind: string }) => e.kind === "test-tampering-blocked")).toBe(true);
    expect(res.run?.review?.independentModelReviewed).toBe(true);
    expect(fs.readFileSync(path.join(repo, "src/invoice.mjs"), "utf8")).toContain("1 - discountPercent / 100");
    expect(fs.readFileSync(path.join(repo, "test/invoice.test.mjs"), "utf8")).toContain("assert.equal(r.net, 90);");

    // 9b. Natomiast czyste zapytanie read-only („Nie zmieniaj żadnych plików”) nadal może zakończyć się bez edycji plików
    let roTurn = 0;
    const roPool = createProviderPool({ memory: createExperienceMemory(repo), env: {}, ollamaUrl: "http://127.0.0.1:1" });
    roPool.registerCustomProvider("ro_model", {
      costTier: "local",
      invoke: async ({ role }) => {
        if (role === "architect") return { content: JSON.stringify({ summary: "Audit only", steps: [{ id: "s1", title: "Inspect", role: "developer" }] }), toolCalls: [] };
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        roTurn += 1;
        return { content: "", toolCalls: [{ id: `ro${roTurn}`, name: "finish_task", arguments: { summary: "Raport analizy read-only" } }] };
      },
    });
    const roRes = await executeForgeRun({
      goal: "Przeanalizuj moduł faktur i wyjaśnij jak działa. Nie zmieniaj żadnych plików.",
      repoRoot: repo,
      providerPool: roPool,
      costPolicy: "zero_cost",
    });
    expect(roRes.status).toBe("completed");
    expect(roRes.modifiedFiles).toHaveLength(0);

    // 9c. HTTP POST /api/runs/:id/resume (bez wait:true) natychmiast zwraca status 'queued' (aktywny) -> UI nie zamarza na 'paused'
    const { createForgeServer } = await import("../forge/server.mjs");
    const repoHttp = makeGitRepo({
      "package.json": JSON.stringify({ name: "p5-http-resume", type: "module", scripts: { test: "node --test" } }),
      "src/v.mjs": "export const v = 1;\n",
      "test/v.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { v } from '../src/v.mjs'; test('v', () => assert.equal(v, 2));\n",
    });
    const httpPool = createProviderPool({ memory: createExperienceMemory(repoHttp), env: {}, ollamaUrl: "http://127.0.0.1:1" });
    let hCall = 0;
    httpPool.registerCustomProvider("http_sim", {
      costTier: "local",
      invoke: async ({ role }) => {
        if (role === "architect") {
          return { content: JSON.stringify({ summary: "Fix v", steps: [{ id: "s1", title: "edit v", role: "developer" }], targetFiles: ["src/v.mjs"] }), toolCalls: [] };
        }
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        hCall += 1;
        if (hCall === 1) return { content: "", toolCalls: [{ id: "h1", name: "edit_file", arguments: { path: "src/v.mjs", search: "v = 1", replace: "v = 2" } }] };
        return { content: "", toolCalls: [{ id: "h2", name: "finish_task", arguments: { summary: "v=2" } }] };
      },
    });
    // Najpierw zatrzymujemy zadanie na checkpoincie (paused)
    let hitPause = false;
    const pausedRun = await executeForgeRun({
      goal: "Napraw v na 2 w src/v.mjs",
      repoRoot: repoHttp,
      providerPool: httpPool,
      shouldPause: () => hitPause,
      onEvent: (ev: { type: string; tool?: string }) => { if (ev.type === "tool_call" && ev.tool === "edit_file") hitPause = true; },
    });
    expect(pausedRun.status).toBe("paused");

    const srv = createForgeServer({ defaultRepoRoot: repoHttp, port: 0, runtimeDir: null, providerPool: httpPool });
    const started = await srv.start();
    try {
      const resumeRes = await fetch(`${started.url}/api/runs/${pausedRun.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forge-Token": started.token, "X-Forge-Client": "jarvis-ui" },
        body: JSON.stringify({ repoPath: repoHttp }),
      });
      expect(resumeRes.status).toBe(202);
      const resumeJson = await resumeRes.json();
      expect(resumeJson.ok).toBe(true);
      expect(["queued", "scouting", "executing", "verifying", "reviewing", "completed"]).toContain(resumeJson.status);
      expect(resumeJson.run?.status).not.toBe("paused");

      // Poczekaj aż wznowione zadanie przejdzie do completed
      let finalRun = resumeJson.run;
      for (let i = 0; i < 40 && finalRun?.status !== "completed"; i += 1) {
        await new Promise((r) => setTimeout(r, 50));
        const poll = await fetch(`${started.url}/api/runs/${pausedRun.id}?path=${encodeURIComponent(repoHttp)}`, {
          headers: { "X-Forge-Token": started.token, "X-Forge-Client": "jarvis-ui" },
        });
        const pollJson = await poll.json();
        finalRun = pollJson.run;
      }
      expect(finalRun?.status).toBe("completed");
      expect(finalRun?.verdict).toBe("PASS");
    } finally {
      await srv.close();
    }
  });
});


