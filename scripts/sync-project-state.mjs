#!/usr/bin/env node
/**
 * Generator rzeczywistego stanu projektu → project-memory/CURRENT_STATE.json + CURRENT_STATE.md
 *
 *   node scripts/sync-project-state.mjs                 # tylko zbierz stan (czyta istniejące raporty)
 *   node scripts/sync-project-state.mjs --run all       # NAJPIERW naprawdę uruchom secret-scan, lint, test, build
 *   node scripts/sync-project-state.mjs --run test,lint # wybrane checki
 *   node scripts/sync-project-state.mjs --apk           # dodatkowo zapytaj GitHub (gh) o ostatni APK
 *   node scripts/sync-project-state.mjs --verify        # sprawdź, czy pliki generowane nie były edytowane ręcznie
 *   node scripts/sync-project-state.mjs --print         # wypisz CURRENT_STATE.md na stdout
 *
 * Bez sieci i bez zapytań do modeli AI (poza opcjonalnym --apk → gh CLI).
 */
import path from "node:path";
import fs from "node:fs";
import { DEFAULT_CHECKS, runCheck, runApkCheck, syncState, verifyGenerated, MEMORY_DIR } from "./lib/project-memory.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? "" : null;
};
const root = path.resolve(opt("--root") || path.join(import.meta.dirname, ".."));

if (args.includes("--verify")) {
  const problems = verifyGenerated(root);
  if (problems.length) {
    console.error("❌ project-memory:\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log("✅ Pliki generowane project-memory są nienaruszone.");
  process.exit(0);
}

const runList = opt("--run");
let failed = 0;
if (runList != null) {
  const names = runList === "" || runList === "all" ? Object.keys(DEFAULT_CHECKS) : runList.split(",").map((s) => s.trim()).filter(Boolean);
  for (const name of names) {
    if (!DEFAULT_CHECKS[name]) {
      console.error(`Nieznany check "${name}". Dostępne: ${Object.keys(DEFAULT_CHECKS).join(", ")}`);
      process.exit(2);
    }
    process.stdout.write(`▶ ${name}: ${[DEFAULT_CHECKS[name].command, ...DEFAULT_CHECKS[name].args].join(" ")} … `);
    const r = runCheck(root, name);
    if (!r.available) console.log(`UNKNOWN (${r.unavailableReason})`);
    else {
      console.log(`exit ${r.exitCode} (${Math.round(r.durationMs / 1000)} s) → ${r.logPath}`);
      if (r.exitCode !== 0) failed++;
    }
  }
}

if (args.includes("--apk")) {
  const r = runApkCheck(root);
  console.log(`▶ apk: run ${r.lastRun?.databaseId ?? "?"} ${r.lastRun?.conclusion ?? "UNKNOWN"} · release ${r.releaseTag ?? "?"} · ${r.apkAssets.length} plik(ów) .apk`);
}

const state = syncState(root);
const summary = Object.entries(state.checks).map(([k, v]) => `${k}=${v.status}`).join(" ");
console.log(`✅ ${MEMORY_DIR}/CURRENT_STATE.{json,md} @ ${state.git.shortCommit} (${state.git.branch}) · ${summary} apk=${state.apk.status}`);
if (args.includes("--print")) console.log("\n" + fs.readFileSync(path.join(root, MEMORY_DIR, "CURRENT_STATE.md"), "utf8"));
process.exit(failed ? 1 : 0);
