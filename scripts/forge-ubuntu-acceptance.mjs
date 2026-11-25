#!/usr/bin/env node
/**
 * JARVIS FORGE — Procedura odbioru na fizycznym komputerze Ubuntu.
 *
 * Uruchomienie na docelowej maszynie Ubuntu:
 *   npm run forge:accept
 *   # lub z wykonaniem prawdziwego zadania kodującego na lokalnej Ollamie:
 *   node scripts/forge-ubuntu-acceptance.mjs --live-task
 *
 * Weryfikuje (bez mylenia parametrów VM z parametrami hosta użytkownika):
 *  1. Rzeczywiste zasoby sprzętowe hosta (CPU, RAM, GPU/VRAM, OS, sesja graficzna, dysk).
 *  2. Uruchomienie i zabezpieczenia daemona Forge (127.0.0.1, X-Forge-Client, Origin:null, token).
 *  3. Gotowość integracji Electron (`electron/local-forge.cjs`, binarka Electron, preload bridge).
 *  4. Lokalną Ollamę (`/api/tags`, zainstalowane modele, dobór modelu pod wykryty sprzęt).
 *  5. Obsługę przerwania (pause/cancel), wznowienia z checkpointu i deterministycznego rollbacku.
 *  6. Poprawność artefaktów interfejsu UI (`dist/` + chunk `ForgeWorkspace`).
 *  7. (Opcjonalnie `--live-task` lub automatycznie gdy Ollama ma model) Prawdziwe zadanie programistyczne na izolowanym repo Git!
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createForgeServer } from "../forge/server.mjs";
import { createProviderPool, detectHardwareProfile } from "../forge/providers.mjs";
import { executeForgeRun, rollbackForgeRun } from "../forge/engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const RUN_LIVE_TASK = process.argv.includes("--live-task") || !process.argv.includes("--skip-live-task");

const results = [];
function record(id, status, detail) {
  results.push({ id, status, detail });
  const icon = status === "PASS" ? "✅" : status === "WARN" ? "⚠️" : "❌";
  console.log(`${icon} [${status}] ${id}: ${detail}`);
}

function readOsPrettyName() {
  try {
    const raw = fs.readFileSync("/etc/os-release", "utf8");
    const m = raw.match(/^PRETTY_NAME="?(.*?)"?$/m);
    return m ? m[1] : `${os.platform()} ${os.release()}`;
  } catch {
    return `${os.platform()} ${os.release()}`;
  }
}

async function runHttp(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  console.log("⚒ JARVIS FORGE — Odbiór techniczny na maszynie Ubuntu\n");

  // 1. Rzeczywiste zasoby sprzętowe hosta (NIE zakładane, NIE z VM!)
  const hw = detectHardwareProfile();
  const osName = readOsPrettyName();
  const sessionType = process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? "wayland" : process.env.DISPLAY ? "x11" : "headless");
  let diskFree = "unknown";
  try {
    diskFree = execFileSync("df", ["-h", REPO], { encoding: "utf8" }).trim().split("\n")[1]?.split(/\s+/)[3] || "unknown";
  } catch { /* ignore */ }
  record(
    "1_host_hardware",
    "PASS",
    `Host: ${osName} · Sesja: ${sessionType} · ${hw.cpuCores} vCPU · ${hw.totalRamGb} GB RAM (${hw.freeRamGb} GB wolne) · GPU: ${hw.gpu ? `${hw.gpu.name} (${hw.gpu.vramGb} GB VRAM)` : "brak"} · Dysk wolny: ${diskFree} · Profil: ${hw.tier}`,
  );

  // 2. Daemon Forge (loopback + autoryzacja + blokada Origin:null)
  const runtimeDir = path.join(os.tmpdir(), `jarvis-forge-accept-rt-${process.pid}`);
  const srv = createForgeServer({ defaultRepoRoot: REPO, port: 0, runtimeDir });
  let started;
  try {
    started = await srv.start();
    const health = await runHttp(`${started.url}/api/health`);
    const badClient = await runHttp(`${started.url}/api/session`);
    const badOrigin = await runHttp(`${started.url}/api/session`, { headers: { "X-Forge-Client": "jarvis-ui", Origin: "null" } });
    const goodSess = await runHttp(`${started.url}/api/session`, { headers: { "X-Forge-Client": "jarvis-ui" } });
    const connExists = fs.existsSync(path.join(runtimeDir, "connection.json"));
    const ok = health.ok && badClient.status === 403 && badOrigin.status === 403 && goodSess.ok && Boolean(goodSess.data?.token) && connExists;
    record(
      "2_forge_daemon_security",
      ok ? "PASS" : "FAIL",
      `url=${started.url}, health=${health.status}, noClient=${badClient.status}, originNull=${badOrigin.status}, session=${goodSess.status}, connectionJson=${connExists}`,
    );
  } finally {
    await srv.close();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }

  // 3. Integracja Electron
  const localForgePath = path.join(REPO, "electron/local-forge.cjs");
  const preloadPath = path.join(REPO, "electron/preload.cjs");
  const mainPath = path.join(REPO, "electron/main.cjs");
  const electronBin = path.join(REPO, "node_modules/electron/dist/electron");
  const mainSrc = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, "utf8") : "";
  const preloadSrc = fs.existsSync(preloadPath) ? fs.readFileSync(preloadPath, "utf8") : "";
  const wired = fs.existsSync(localForgePath)
    && preloadSrc.includes("ensureLocalForge")
    && preloadSrc.includes("jarvis:forge-ensure-local")
    && mainSrc.includes("local-forge.cjs")
    && mainSrc.includes("jarvis:forge-ensure-local");
  const hasElectronBin = fs.existsSync(electronBin);
  record(
    "3_electron_integration",
    wired && hasElectronBin ? "PASS" : wired ? "WARN" : "FAIL",
    wired
      ? (hasElectronBin
        ? `Mostek IPC + local-forge.cjs obecny, binarka Electron zainstalowana (${electronBin}).`
        : "Mostek IPC + local-forge.cjs poprawnie podpięty, ale binarka Electron nie jest zainstalowana w node_modules (uruchom `npm install` na docelowym Ubuntu).")
      : "Brak poprawnego podpięcia local-forge.cjs w Electron.",
  );

  // 4. Lokalna Ollama
  const pool = createProviderPool();
  const oll = await pool.probeOllama(true);
  record(
    "4_local_ollama",
    oll.online && oll.models.length > 0 ? "PASS" : "WARN",
    oll.online
      ? (oll.models.length
        ? `Online (${oll.url}), modele (${oll.models.length}): ${oll.models.slice(0, 6).join(", ")}`
        : `Online (${oll.url}), ale brak pobranych modeli — uruchom np.: ollama pull ${hw.recommendedOllamaModels[0]}`)
      : `Nieosiągalna pod ${oll.url} — zainstaluj i uruchom \`ollama serve\` oraz \`ollama pull ${hw.recommendedOllamaModels[0]}\`.`,
  );

  // 5. Obsługa przerwania (pause), wznowienia z checkpointu i deterministycznego rollbacku (lokalne repo tmp)
  const tmpPauseRepo = path.join(os.tmpdir(), `jarvis-forge-accept-pause-${process.pid}`);
  try {
    fs.mkdirSync(path.join(tmpPauseRepo, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpPauseRepo, "package.json"), JSON.stringify({ name: "accept-pause", type: "module", scripts: { test: "node --test" } }));
    fs.writeFileSync(path.join(tmpPauseRepo, "src/val.mjs"), "export const v = 1;\n");
    fs.writeFileSync(path.join(tmpPauseRepo, "val.test.mjs"), "import test from 'node:test'; import assert from 'node:assert/strict'; import { v } from './src/val.mjs'; test('v===2', () => assert.equal(v, 2));\n");
    execFileSync("git", ["init", "-q"], { cwd: tmpPauseRepo });
    execFileSync("git", ["config", "user.email", "accept@jarvis.local"], { cwd: tmpPauseRepo });
    execFileSync("git", ["config", "user.name", "Accept"], { cwd: tmpPauseRepo });
    execFileSync("git", ["add", "."], { cwd: tmpPauseRepo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmpPauseRepo });

    const testPool = createProviderPool({ ollamaUrl: "http://127.0.0.1:1" });
    let calls = 0;
    testPool.registerCustomProvider("accept-local", {
      costTier: "local",
      invoke: async ({ role }) => {
        if (role === "architect") return { content: JSON.stringify({ summary: "Fix v", steps: [{ id: "s1", title: "edit", role: "developer" }] }), toolCalls: [] };
        if (role === "reviewer") return { content: JSON.stringify({ approved: true, summary: "OK", issues: [] }), toolCalls: [] };
        calls += 1;
        if (calls === 1) return { content: "", toolCalls: [{ id: "c1", name: "edit_file", arguments: { path: "src/val.mjs", search: "v = 1", replace: "v = 2" } }] };
        return { content: "", toolCalls: [{ id: "c2", name: "finish_task", arguments: { summary: "Updated v=2" } }] };
      },
    });
    let pauseNow = false;
    const paused = await executeForgeRun({
      goal: "Update v to 2",
      repoRoot: tmpPauseRepo,
      providerPool: testPool,
      shouldPause: () => pauseNow,
      onEvent: (ev) => { if (ev.type === "tool_call") pauseNow = true; },
    });
    const resumed = await executeForgeRun({ repoRoot: tmpPauseRepo, providerPool: testPool, resumeRunId: paused.id });
    const afterResume = fs.readFileSync(path.join(tmpPauseRepo, "src/val.mjs"), "utf8").trim();
    const rb = rollbackForgeRun({ repoRoot: tmpPauseRepo, runId: paused.id });
    const afterRb = fs.readFileSync(path.join(tmpPauseRepo, "src/val.mjs"), "utf8").trim();
    const ok5 = paused.status === "paused" && resumed.status === "completed" && afterResume === "export const v = 2;" && rb.restoredCount >= 1 && afterRb === "export const v = 1;";
    record("5_pause_resume_rollback", ok5 ? "PASS" : "FAIL", `paused=${paused.status}, resumed=${resumed.status}, rollbackRestored=${rb.restoredCount}`);
  } finally {
    fs.rmSync(tmpPauseRepo, { recursive: true, force: true });
  }

  // 6. Artefakty UI (dist/ + chunk ForgeWorkspace)
  const distAssets = path.join(REPO, "dist/assets");
  const hasForgeChunk = fs.existsSync(distAssets) && fs.readdirSync(distAssets).some((f) => /ForgeWorkspace/i.test(f));
  record(
    "6_ui_build_artifacts",
    hasForgeChunk ? "PASS" : "WARN",
    hasForgeChunk
      ? "Build produkcyjny obecny (chunk ForgeWorkspace w dist/assets)."
      : "Brak aktualnego dist/assets/ForgeWorkspace* — uruchom `npm run build`.",
  );

  // 7. Prawdziwe zadanie programistyczne na lokalnej Ollamie (jeśli dostępna)
  if (RUN_LIVE_TASK && oll.online && oll.models.length > 0) {
    const tmpLive = path.join(os.tmpdir(), `jarvis-forge-accept-live-${process.pid}`);
    try {
      fs.mkdirSync(path.join(tmpLive, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpLive, "package.json"), JSON.stringify({ name: "accept-live", type: "module", scripts: { test: "node --test" } }));
      fs.writeFileSync(path.join(tmpLive, "src/math.mjs"), "export function sumPositive(arr) {\n  return arr.reduce((a, b) => a + b, 0);\n}\n");
      fs.writeFileSync(path.join(tmpLive, "math.test.mjs"), "import test from 'node:test'; import assert from 'node:assert/strict'; import { sumPositive } from './src/math.mjs'; test('ignores negatives', () => assert.equal(sumPositive([3, -2, 5, -1]), 8));\n");
      execFileSync("git", ["init", "-q"], { cwd: tmpLive });
      execFileSync("git", ["config", "user.email", "accept@jarvis.local"], { cwd: tmpLive });
      execFileSync("git", ["config", "user.name", "Accept"], { cwd: tmpLive });
      execFileSync("git", ["add", "."], { cwd: tmpLive });
      execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmpLive });

      const t0 = Date.now();
      const liveRun = await executeForgeRun({
        goal: "Fix sumPositive in src/math.mjs so it sums only positive numbers and passes npm test without changing the test file.",
        repoRoot: tmpLive,
        providerPool: pool,
        costPolicy: "local_only",
        maxIterations: 8,
        maxRepairCycles: 2,
      });
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      record(
        "7_live_coding_task_local_ollama",
        liveRun.status === "completed" ? "PASS" : "WARN",
        `status=${liveRun.status}, czas=${sec}s, iteracje=${liveRun.iteration}, model=${liveRun.providersUsed.join(",") || "brak"}`,
      );
    } finally {
      fs.rmSync(tmpLive, { recursive: true, force: true });
    }
  } else {
    record(
      "7_live_coding_task_local_ollama",
      "WARN",
      "Pominięto (Ollama niedostępna lub brak pobranego modelu) — uruchom ponownie po `ollama serve && ollama pull qwen2.5-coder:7b`.",
    );
  }

  pool.close?.();
  const failed = results.filter((r) => r.status === "FAIL");
  const warned = results.filter((r) => r.status === "WARN");
  console.log(`\n📊 Podsumowanie odbioru Ubuntu: ${results.length - failed.length - warned.length} PASS · ${warned.length} WARN · ${failed.length} FAIL`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("❌ Błąd procedury odbioru:", e);
  process.exit(1);
});
