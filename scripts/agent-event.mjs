#!/usr/bin/env node
/**
 * Odporny dziennik agentów — każde zdarzenie to NOWY plik w project-memory/events/.
 *
 *   node scripts/agent-event.mjs record --agent codex --task fix-tts --start <sha> \
 *        --summary "..." --next "..." [--problem "..."]... [--hypothesis "..."]... \
 *        [--command "npm test=0"]... [--checks test,lint,build] [--adr ADR-0001] [--model "..."]
 *   node scripts/agent-event.mjs validate        # waliduj wszystkie zdarzenia (exit 1 przy błędzie)
 *
 * Pliki zmienione i commit końcowy są zbierane z gita (start..HEAD + niezatwierdzone).
 * Wyniki testów (--checks) pochodzą WYŁĄCZNIE z raportów project-memory/reports/<check>.json,
 * ocenionych względem bieżącego stanu (PASS/FAIL/STALE/UNKNOWN) — nigdy z deklaracji agenta.
 */
import path from "node:path";
import fs from "node:fs";
import {
  MEMORY_DIR, evaluateReport, git, readEvents, readJson, reportDigest, worktreeFingerprint, writeEvent,
} from "./lib/project-memory.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const many = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] != null ? [argv[i + 1]] : []));
const one = (name) => many(name)[0] ?? null;
const root = path.resolve(one("--root") || path.join(import.meta.dirname, ".."));

if (cmd === "validate") {
  const events = readEvents(root);
  const bad = events.filter((e) => !e.valid);
  for (const e of bad) console.error(`❌ ${e.file}\n   - ${e.errors.join("\n   - ")}`);
  console.log(`${bad.length ? "❌" : "✅"} zdarzenia: ${events.length - bad.length}/${events.length} poprawnych`);
  process.exit(bad.length ? 1 : 0);
}

if (cmd !== "record") {
  console.error("Użycie: agent-event.mjs record|validate … (szczegóły w nagłówku pliku)");
  process.exit(2);
}

const head = git(root, ["rev-parse", "HEAD"]) || "UNKNOWN";
const start = one("--start") || head;
const dirty = (git(root, ["status", "--porcelain=v1", "-uall"]) || "").split("\n").filter(Boolean);
const committed = start !== head && start !== "UNKNOWN" ? (git(root, ["diff", "--name-only", `${start}..HEAD`]) || "").split("\n").filter(Boolean) : [];
const changedFiles = [...new Set([...committed, ...dirty.map((l) => l.slice(3))])].filter((f) => !f.startsWith(`${MEMORY_DIR}/events/`)).sort();
const codeDirty = dirty.some((l) => !l.slice(3).startsWith(`${MEMORY_DIR}/`));

const fingerprint = worktreeFingerprint(root);
const testResults = (one("--checks") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((check) => {
    const reportPath = `${MEMORY_DIR}/reports/${check}.json`;
    const report = readJson(path.join(root, reportPath));
    if (!report) return { check, status: "NOT_RUN", source: "not-run", summary: "brak raportu — uruchom: node scripts/sync-project-state.mjs --run " + check };
    const ev = evaluateReport(report, { commit: head, fingerprint });
    return {
      check,
      status: ev.status,
      source: "report",
      command: report.command,
      exitCode: report.exitCode ?? null,
      reportPath,
      reportCommit: report.commit,
      reportDigest: reportDigest(report),
      finishedAt: report.finishedAt,
      summary: [ev.reason, ...Object.values(report.summary || {}).filter(Boolean)].join(" · ").slice(0, 300),
    };
  });

const commands = many("--command").map((c) => {
  const m = c.match(/^(.*)=(-?\d+)$/);
  return m ? { command: m[1], exitCode: Number(m[2]) } : { command: c, exitCode: null };
});

try {
  const { file, event } = writeEvent(root, {
    taskId: one("--task"),
    agent: one("--agent"),
    ...(one("--model") ? { model: one("--model") } : {}),
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]) || "UNKNOWN",
    startCommit: start,
    endCommit: codeDirty ? "UNCOMMITTED" : head,
    summary: one("--summary"),
    changedFiles,
    commands,
    testResults,
    problems: many("--problem"),
    hypotheses: many("--hypothesis"),
    nextStep: one("--next"),
    relatedDecisions: many("--adr"),
  });
  console.log(`✅ ${path.relative(root, file)}${event.redactions ? ` (zredagowano ${event.redactions} sekret(ów))` : ""}`);
  if (fs.existsSync(path.join(root, MEMORY_DIR, "CURRENT_STATE.json"))) console.log("ℹ Odśwież stan: npm run memory:sync");
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
