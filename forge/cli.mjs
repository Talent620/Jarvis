#!/usr/bin/env node
/**
 * JARVIS FORGE — CLI (Command-Line Interface).
 *
 * Przykłady:
 *   node forge/cli.mjs status [--repo .]
 *   node forge/cli.mjs inspect [--repo .] [--query "routing"]
 *   node forge/cli.mjs providers [--policy zero_cost]
 *   node forge/cli.mjs autopilot "Co mam zbudować, naprawić lub ulepszyć?" [--repo .]
 *   node forge/cli.mjs autopilot-plan "Opis zadania" [--repo .]
 *   node forge/cli.mjs decide <runId> <approve|reject> [--repo .]
 *   node forge/cli.mjs run "Napraw błąd w module X" [--repo .] [--policy zero_cost]
 *   node forge/cli.mjs resume <runId> [--repo .]
 *   node forge/cli.mjs rollback <runId> [--repo .]
 *   node forge/cli.mjs memory [--repo .]
 */
import path from "node:path";
import { buildRepoMap, scanRepository } from "./repo-intel.mjs";
import { createExperienceMemory } from "./memory.mjs";
import { createProviderPool } from "./providers.mjs";
import { verifyModalPromoStatus } from "./budget.mjs";
import { assessTaskDifficulty, composeAgentTeam } from "./adaptive.mjs";
import { createForgeStore, executeCompetitiveForgeRun, executeForgeRun, rollbackForgeRun } from "./engine.mjs";
import { decideAutopilotMission, executeAutopilotMission, planAutopilotMission, resumeAutopilotMission } from "./autopilot.mjs";
import { isGitWorktreeCapable } from "./worktree.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0] || "status";

function opt(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

function hasFlag(name) {
  return argv.includes(name);
}

const repoRoot = path.resolve(opt("--repo", process.cwd()));
const costPolicy = opt("--policy", "zero_cost");
const useWorktree = hasFlag("--worktree");
const adaptive = !hasFlag("--no-adaptive");
const leanSimple = hasFlag("--lean-simple");
const promoExpUsd = opt("--promo-budget", null);
const promoTotalUsd = opt("--promo-total", null);
const promoTimeoutSec = opt("--promo-timeout", null);
const promoBudget = promoExpUsd
  ? {
      maxExperimentUsd: Number(promoExpUsd),
      maxTotalUsd: Number(promoTotalUsd || promoExpUsd),
      maxDurationSeconds: Number(promoTimeoutSec || 180),
      gpuSpec: opt("--promo-gpu", "L4"),
    }
  : null;

async function main() {
  const memory = createExperienceMemory(repoRoot);
  const enableModal = costPolicy === "allow_promo_credits" || costPolicy === "allow_credits" || hasFlag("--modal-bridge");
  const pool = createProviderPool({ memory, enableModalBridge: enableModal });

  try {
    if (cmd === "status") {
      const idx = scanRepository(repoRoot);
      const matrix = await pool.getProviderMatrix({ costPolicy, promoBudget, probeLocal: true });
      const ready = matrix.filter((p) => p.status === "ready");
      const runs = createForgeStore(repoRoot).listRuns(5);
      const snap = memory.getSnapshot();
      console.log(`⚒ JARVIS FORGE — Status`);
      console.log(`Repo: ${idx.profile.name} (${repoRoot}) · ${idx.totalFiles} plików · ${idx.edgeCount} zależności`);
      console.log(`Sprzęt: ${pool.hardware.cpuCores} vCPU · ${pool.hardware.totalRamGb} GB RAM · GPU: ${pool.hardware.gpu ? `${pool.hardware.gpu.name} (${pool.hardware.gpu.vramGb} GB)` : "brak"} · profil: ${pool.hardware.tier}`);
      console.log(`Strategia lokalna: ${pool.hardware.localStrategy}`);
      console.log(`Dostawcy (${costPolicy}): ${ready.length}/${matrix.length} gotowych [${ready.map((p) => `${p.id}:${p.defaultModel}`).join(", ") || "brak — skonfiguruj darmowy klucz lub Ollamę"}]`);
      console.log(`Pamięć doświadczeń: ${snap.lessons.length} zweryfikowanych lekcji · ${snap.failedAttempts.length} nieudanych prób · ${snap.decisions.length} decyzji · ${runs.length} ostatnich runów`);
      return;
    }

    if (cmd === "budget") {
      const modalStatus = verifyModalPromoStatus();
      console.log(JSON.stringify({
        categories: ["A: local_free (Ollama/CPU/GPU)", "B: api_free (darmowe tiery API)", "C: promo_credits (kontrolowany budżet, Billed=$0.00 + disclaimer o opóźnieniu rozliczeń)"],
        modalPromoStatus: modalStatus,
      }, null, 2));
      return;
    }

    if (cmd === "assess") {
      const goal = argv[1] && !argv[1].startsWith("--") ? argv[1] : opt("--goal", "");
      if (!goal) {
        console.error('Podaj cel: node forge/cli.mjs assess "Opis zadania"');
        process.exit(2);
      }
      const idx = scanRepository(repoRoot);
      const matrix = await pool.getProviderMatrix({ costPolicy, promoBudget, probeLocal: true });
      const difficulty = assessTaskDifficulty({ goal, repoIndex: idx, memory });
      const team = composeAgentTeam({
        difficulty,
        repoIndex: idx,
        providerMatrix: matrix,
        hardware: pool.hardware,
        costPolicy,
        allowCompetitive: hasFlag("--competitive"),
        hasPromoBudget: Boolean(promoBudget),
        isWorktreeReady: isGitWorktreeCapable(repoRoot),
      });
      console.log(JSON.stringify({ difficulty, team }, null, 2));
      return;
    }

    if (cmd === "inspect") {
      const query = opt("--query", "");
      const idx = scanRepository(repoRoot);
      const map = buildRepoMap(idx, { query, maxChars: 6000 });
      console.log(map.text);
      return;
    }

    if (cmd === "providers") {
      const matrix = await pool.getProviderMatrix({ costPolicy, promoBudget, probeLocal: true });
      console.log(`Dostawcy AI (polityka: ${costPolicy}) · sprzęt: ${pool.hardware.tier}`);
      for (const p of matrix) {
        console.log(`- [${p.status}] ${p.id} (${p.costCategory}) · model: ${p.defaultModel} · ${p.statusReason}`);
      }
      return;
    }

    if (cmd === "memory") {
      const snap = memory.getSnapshot();
      console.log(JSON.stringify({
        repoRoot: snap.repoRoot,
        architecture: snap.architecture,
        lessonsCount: snap.lessons.length,
        lessons: snap.lessons.slice(0, 10),
        failedAttemptsCount: snap.failedAttempts.length,
        decisionsCount: snap.decisions.length,
        modelStats: snap.modelStats,
        strategyStats: snap.strategyStats,
        recentTasks: snap.taskHistory.slice(0, 10),
      }, null, 2));
      return;
    }

    if (cmd === "compete") {
      const goal = argv[1] && !argv[1].startsWith("--") ? argv[1] : opt("--goal", "");
      if (!goal) {
        console.error('Podaj cel: node forge/cli.mjs compete "Trudne zadanie" [--repo .]');
        process.exit(2);
      }
      const res = await executeCompetitiveForgeRun({
        goal,
        repoRoot,
        providerPool: pool,
        costPolicy,
        promoBudget,
        onEvent: (ev) => {
          if (ev.actionLabel) console.log(`[${ev.candidateId || "comp"}:${ev.phase}/${ev.role}] ${ev.actionLabel}`);
        },
      });
      console.log(JSON.stringify({ status: res.status, difficulty: res.difficulty, comparison: res.comparison, mergedFiles: res.mergedFiles }, null, 2));
      process.exit(res.ok ? 0 : 1);
    }

    if (cmd === "autopilot-plan") {
      const goal = argv[1] && !argv[1].startsWith("--") ? argv[1] : opt("--goal", "");
      if (!goal) {
        console.error('Podaj cel: node forge/cli.mjs autopilot-plan "Co mam zrobić?"');
        process.exit(2);
      }
      const plan = await planAutopilotMission({
        goal,
        repoRoot,
        providerPool: pool,
        costPolicy,
        promoBudget,
        allowCompetitive: hasFlag("--competitive"),
        probeLocal: true,
      });
      console.log(JSON.stringify(plan, null, 2));
      return;
    }

    if (cmd === "autopilot") {
      const goal = argv[1] && !argv[1].startsWith("--") ? argv[1] : opt("--goal", "");
      if (!goal) {
        console.error('Podaj cel: node forge/cli.mjs autopilot "Co mam zbudować, naprawić lub ulepszyć?"');
        process.exit(2);
      }
      const timeoutMs = opt("--timeout-ms", null);
      const res = await executeAutopilotMission({
        goal,
        repoRoot,
        providerPool: pool,
        costPolicy,
        promoBudget,
        allowCompetitive: hasFlag("--competitive"),
        maxDurationMs: timeoutMs ? Number(timeoutMs) : null,
        onEvent: (ev) => {
          if (ev.actionLabel) console.log(`[autopilot:${ev.phase}/${ev.role}] ${ev.actionLabel}`);
        },
      });
      const id = res.run?.id || "competitive";
      console.log(`\n=== AUTOPILOT (${id}): ${res.verdict} (${res.status}) ===`);
      if (res.run?.finalResult) console.log(res.run.finalResult);
      if (res.decisionRequired && res.run?.pendingDecision) {
        console.log(`⚠️ WYMAGANA DECYZJA UŻYTKOWNIKA: ${res.run.pendingDecision.title}`);
        console.log(`   Powód: ${res.run.pendingDecision.reason}`);
        if (res.status === "waiting_approval") {
          console.log(`   Uruchom: node forge/cli.mjs decide ${id} approve|reject --repo "${repoRoot}"`);
        }
      }
      process.exit(res.ok ? 0 : 1);
    }

    if (cmd === "decide") {
      const runId = argv[1];
      const decision = argv[2];
      if (!runId || !decision) {
        console.error("Użycie: node forge/cli.mjs decide <runId> <approve|reject> [--repo .]");
        process.exit(2);
      }
      const res = await decideAutopilotMission({
        runId,
        repoRoot,
        decision,
        providerPool: pool,
        onEvent: (ev) => {
          if (ev.actionLabel) console.log(`[autopilot:${ev.phase}/${ev.role}] ${ev.actionLabel}`);
        },
      });
      console.log(`\n=== DECYZJA (${runId}): ${res.verdict} (${res.status}) ===\n${res.run?.finalResult || ""}`);
      process.exit(res.ok ? 0 : 1);
    }

    if (cmd === "run") {
      const goal = argv[1] && !argv[1].startsWith("--") ? argv[1] : opt("--goal", "");
      if (!goal) {
        console.error('Podaj cel: node forge/cli.mjs run "Co mam zbudować, naprawić lub ulepszyć?"');
        process.exit(2);
      }
      const res = await executeForgeRun({
        goal,
        repoRoot,
        providerPool: pool,
        costPolicy,
        promoBudget,
        useWorktree,
        adaptive,
        leanSimple,
        onEvent: (ev) => {
          if (ev.actionLabel) console.log(`[${ev.phase}/${ev.role}] ${ev.actionLabel}`);
        },
      });
      console.log(`\n=== WYNIK (${res.id}): ${res.status.toUpperCase()} ===\n${res.finalResult || ""}`);
      if (res.budgetSnapshot) {
        console.log(`Budżet kredytów promocyjnych: $${res.budgetSnapshot.experimentSpentUsd} / $${res.budgetSnapshot.maxExperimentUsd} (łącznie $${res.budgetSnapshot.totalSpentUsd} / $${res.budgetSnapshot.maxTotalUsd} · outOfPocket=$0.00)`);
      }
      process.exit(res.status === "completed" ? 0 : 1);
    }

    if (cmd === "resume") {
      const runId = argv[1];
      if (!runId) { console.error("Podaj runId do wznowienia."); process.exit(2); }
      const res = await resumeAutopilotMission({
        runId,
        repoRoot,
        providerPool: pool,
        onEvent: (ev) => {
          if (ev.actionLabel) console.log(`[${ev.phase}/${ev.role}] ${ev.actionLabel}`);
        },
      });
      console.log(`\n=== WZNOWIENIE (${res.run.id}): ${res.verdict} (${res.status}) ===\n${res.run.finalResult || ""}`);
      process.exit(res.ok ? 0 : 1);
    }

    if (cmd === "rollback") {
      const runId = argv[1];
      if (!runId) { console.error("Podaj runId do wycofania zmian."); process.exit(2); }
      const res = rollbackForgeRun({ repoRoot, runId });
      console.log(`↩ Rollback ${runId}: przywrócono ${res.restoredCount} plik(ów).`);
      return;
    }

    console.error("Użycie: node forge/cli.mjs <status|budget|assess|inspect|providers|memory|autopilot|autopilot-plan|decide|run|compete|resume|rollback> [argumenty]");
    process.exit(2);
  } finally {
    pool.close?.();
  }
}

main().catch((err) => {
  console.error(`❌ Błąd Forge CLI: ${err.message}`);
  process.exit(1);
});
