#!/usr/bin/env node
// === JARVIS Guardian Daemon (lokalny nadzór bez GitHub Actions i bez płatnych LLM) ===
// Monitoring bazowy działa wyłącznie deterministycznie (git, secret-scan, memory verify, Ollama /api/tags).
// NIGDY nie wywołuje Modal Brain ani płatnych API chmurowych.
// Użycie:
//   node scripts/guardian-daemon.mjs --once [--llm-on-anomaly]
//   node scripts/guardian-daemon.mjs --interval 900

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const once = args.includes("--once");
const llmOnAnomaly = args.includes("--llm-on-anomaly");
const ivIdx = args.indexOf("--interval");
const intervalSec = ivIdx >= 0 && Number(args[ivIdx + 1]) > 0 ? Number(args[ivIdx + 1]) : 900;
const outIdx = args.indexOf("--out");
const customOutPath = (outIdx >= 0 && args[outIdx + 1]) ? args[outIdx + 1] : (process.env.GUARDIAN_HEARTBEAT_PATH || "");
const root = resolve(import.meta.dirname, "..");

function run(cmd, argv) {
  try {
    const out = execFileSync(cmd, argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return { ok: true, code: 0, out };
  } catch (e) {
    return { ok: false, code: e.status ?? 1, out: String(e.stdout || e.stderr || e.message || "").trim() };
  }
}

async function checkLocalOllama() {
  const base = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) return { available: false, models: [] };
    const data = await res.json().catch(() => null);
    const models = Array.isArray(data?.models) ? data.models.map((m) => String(m.name || "")).filter(Boolean) : [];
    return { available: true, models };
  } catch {
    return { available: false, models: [] };
  } finally {
    clearTimeout(t);
  }
}

async function summarizeAnomalyLocally(models, summaryText) {
  if (!models.length) return null;
  const base = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: models[0],
        stream: false,
        prompt: `Podsumuj krótko po polsku wykrytą anomalię repozytorium JARVIS i podaj następny krok:\n${summaryText}`,
      }),
    });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    return typeof d?.response === "string" ? d.response.trim().slice(0, 500) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function runCycle() {
  const now = new Date().toISOString();
  const branch = run("git", ["branch", "--show-current"]).out || "HEAD";
  const head = run("git", ["rev-parse", "--short", "HEAD"]).out;
  const dirty = run("git", ["status", "--short"]).out.split(/\r?\n/).filter(Boolean);
  const ab = run("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
  const [ahead, behind] = ab.ok ? ab.out.split(/\s+/).map(Number) : [null, null];

  const secretScan = run("node", ["scripts/secret-scan.mjs"]);
  const memVerify = run("node", ["scripts/sync-project-state.mjs", "--verify"]);
  const ollama = await checkLocalOllama();

  const anomalies = [];
  if (!secretScan.ok) anomalies.push(`secret-scan failed (code ${secretScan.code})`);
  if (!memVerify.ok) anomalies.push(`memory verify failed (code ${memVerify.code})`);

  let llmDiagnosis = null;
  if (anomalies.length && llmOnAnomaly && ollama.available) {
    llmDiagnosis = await summarizeAnomalyLocally(ollama.models, anomalies.join("; "));
  }

  const report = {
    checkedAt: now,
    branch,
    head,
    dirtyCount: dirty.length,
    ahead,
    behind,
    secretScanOk: secretScan.ok,
    memoryVerifyOk: memVerify.ok,
    ollama: { available: ollama.available, modelCount: ollama.models.length },
    anomalies,
    ...(llmDiagnosis ? { llmDiagnosis } : {}),
  };

  const targetFile = customOutPath
    ? resolve(root, customOutPath)
    : resolve(root, "project-memory/reports/guardian-heartbeat.json");
  mkdirSync(dirname(targetFile), { recursive: true });
  writeFileSync(targetFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rep = await runCycle();
  console.log(JSON.stringify(rep));
  if (!once) {
    setInterval(() => { void runCycle().then((r) => console.log(JSON.stringify(r))); }, intervalSec * 1000);
  }
}
