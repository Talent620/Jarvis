#!/usr/bin/env node
/**
 * JARVIS FORGE — CLI (Command-Line Interface).
 *
 * Przykłady:
 *   node forge/cli.mjs status [--repo .]
 *   node forge/cli.mjs inspect [--repo .] [--query "routing"]
 *   node forge/cli.mjs providers [--policy zero_cost]
 *   node forge/cli.mjs run "Napraw błąd w module X" [--repo .] [--policy zero_cost]
 *   node forge/cli.mjs resume <runId> [--repo .]
 *   node forge/cli.mjs rollback <runId> [--repo .]
 *   node forge/cli.mjs memory [--repo .]
 */
import path from "node:path";
import { buildRepoMap, scanRepository } from "./repo-intel.mjs";
import { createExperienceMemory } from "./memory.mjs";
import { createProviderPool } from "./providers.mjs";
import { createForgeStore, executeForgeRun, rollbackForgeRun } from "./engine.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0] || "status";

function opt(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const repoRoot = path.resolve(opt("--repo", process.cwd()));
const costPolicy = opt("--policy", "zero_cost");

async function main() {
  const memory = createExperienceMemory(repoRoot);
  const pool = createProviderPool({ memory });

  if (cmd === "status") {
    const idx = scanRepository(repoRoot);
    const matrix = await pool.getProviderMatrix({ costPolicy, probeLocal: true });
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

  if (cmd === "inspect") {
    const query = opt("--query", "");
    const idx = scanRepository(repoRoot);
    const map = buildRepoMap(idx, { query, maxChars: 6000 });
    console.log(map.text);
    return;
  }

  if (cmd === "providers") {
    const matrix = await pool.getProviderMatrix({ costPolicy, probeLocal: true });
    console.log(`Dostawcy AI (polityka: ${costPolicy}) · sprzęt: ${pool.hardware.tier}`);
    for (const p of matrix) {
      console.log(`- [${p.status}] ${p.id} (${p.costTier}) · model: ${p.defaultModel} · ${p.statusReason}`);
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
      onEvent: (ev) => {
        if (ev.actionLabel) console.log(`[${ev.phase}/${ev.role}] ${ev.actionLabel}`);
      },
    });
    console.log(`\n=== WYNIK (${res.id}): ${res.status.toUpperCase()} ===\n${res.finalResult || ""}`);
    process.exit(res.status === "completed" ? 0 : 1);
  }

  if (cmd === "resume") {
    const runId = argv[1];
    if (!runId) { console.error("Podaj runId do wznowienia."); process.exit(2); }
    const res = await executeForgeRun({
      repoRoot,
      providerPool: pool,
      resumeRunId: runId,
      costPolicy,
      onEvent: (ev) => {
        if (ev.actionLabel) console.log(`[${ev.phase}/${ev.role}] ${ev.actionLabel}`);
      },
    });
    console.log(`\n=== WZNOWIENIE (${res.id}): ${res.status.toUpperCase()} ===\n${res.finalResult || ""}`);
    process.exit(res.status === "completed" ? 0 : 1);
  }

  if (cmd === "rollback") {
    const runId = argv[1];
    if (!runId) { console.error("Podaj runId do wycofania zmian."); process.exit(2); }
    const res = rollbackForgeRun({ repoRoot, runId });
    console.log(`↩ Rollback ${runId}: przywrócono ${res.restoredCount} plik(ów).`);
    return;
  }

  console.error("Użycie: node forge/cli.mjs <status|inspect|providers|memory|run|resume|rollback> [argumenty]");
  process.exit(2);
}

main().catch((err) => {
  console.error(`❌ Błąd Forge CLI: ${err.message}`);
  process.exit(1);
});
