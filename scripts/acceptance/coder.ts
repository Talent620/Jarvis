// npm run jarvis:coder:acceptance -- --mode=fake|local|codex
// fake (default, CI-safe): the whole coding path on fake Codex / Claude CLIs.
// local: what this machine has (Codex, Claude Code, Ollama, login state) and this repo's checks.
// codex: one real Codex task on a throwaway mini project in the temp folder (uses your Codex plan).
// Writes reports/coder-acceptance-<time>.md and .json. Exit code 0 only when nothing FAILED.
import { mkdirSync, writeFileSync } from "node:fs";
import { renderCoderReport, runCoderAcceptance, type CoderAcceptanceMode } from "../../src/node/coder/acceptance";

const arg = process.argv.slice(2).find((a) => a.startsWith("--mode="));
const mode = (arg ? arg.slice("--mode=".length) : "fake") as CoderAcceptanceMode;
if (!["fake", "local", "codex"].includes(mode)) {
  console.error("usage: npm run jarvis:coder:acceptance -- --mode=fake|local|codex");
  process.exit(2);
}
const report = await runCoderAcceptance({ mode, repoRoot: process.cwd(), log: (l) => console.log(l) });
mkdirSync("reports", { recursive: true });
const stem = `reports/coder-acceptance-${report.startedAt.replace(/[:.]/g, "-")}`;
writeFileSync(`${stem}.md`, renderCoderReport(report));
writeFileSync(`${stem}.json`, JSON.stringify(report, null, 2));
for (const c of report.checks) console.log(`${c.status.padEnd(16)} ${c.name}: ${c.detail}`);
console.log(`\nVerdict: ${report.verdict}. Report: ${stem}.md`);
process.exit(report.verdict === "FAIL" ? 1 : 0);
