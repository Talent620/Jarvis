// === Generator bazy wiedzy o projekcie (Project Knowledge Engine — ETAP 3) ===
// Skanuje src/ i tworzy MODEL wiedzy: dla każdego pliku rola/opis, eksporty, importy, graf
// zależności (uses + usedBy), powiązane testy i ocena jakości (złożoność/krytyczność/ryzyko).
// Wynik: src/generated/knowledge-index.json — czytany przez Developer Copilota (projectKnowledge.ts)
// oraz narzędzie czatu. Uruchom: npm run knowledge
//
// Czysty Node, zero zależności runtime. Parsowanie regexem (lekkie, best-effort) — indeks
// nawigacyjny, nie pełny AST. Idempotentny.

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = "src";
const OUT_DIR = "src/generated";
const OUT = join(OUT_DIR, "knowledge-index.json");

function kindOf(path) {
  if (/\.test\.tsx?$/.test(path)) return "test";
  if (path.includes("/components/")) return "component";
  if (path.includes("/hooks/")) return "hook";
  if (path.includes("/plugins/")) return "plugin";
  if (path.includes("/lib/")) return "lib";
  return "other";
}

function exportsOf(src) {
  const out = new Set();
  const re = /export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  if (/export\s+default/.test(src)) out.add("default");
  return [...out];
}

// Surowe specyfikatory importów (lokalne i zewnętrzne).
function importSpecsOf(src) {
  const out = new Set();
  const re = /(?:import|from)\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  // dynamiczne importy
  const re2 = /import\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = re2.exec(src)) !== null) out.add(m[1]);
  return [...out];
}

function summaryOf(src) {
  const lines = src.split(/\r?\n/);
  const buf = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith("import ") || l === "") { if (buf.length) break; else continue; }
    if (l.startsWith("//")) { buf.push(l.replace(/^\/\/\s?/, "")); continue; }
    if (l.startsWith("/*") || l.startsWith("*")) { buf.push(l.replace(/^\/\*+\s?|^\*+\/?\s?/g, "")); continue; }
    break;
  }
  return buf.join(" ").replace(/=+/g, "").replace(/\s+/g, " ").trim().slice(0, 240);
}

// --- Pass 1: zbierz pliki ---
const raw = [];
function walk(dir) {
  let items;
  try { items = readdirSync(dir); } catch { return; }
  for (const name of items) {
    const path = join(dir, name).replace(/\\/g, "/");
    let st;
    try { st = statSync(path); } catch { continue; }
    if (st.isDirectory()) { if (name === "generated") continue; walk(path); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    let src = "";
    try { src = readFileSync(path, "utf8"); } catch { continue; }
    raw.push({ path, src });
  }
}
walk(ROOT);
walk("tests"); // testy są w osobnym katalogu — bez nich nie powiążemy „plik ↔ test"

const known = new Set(raw.map((r) => r.path));
// Rozwiąż lokalny import do istniejącej ścieżki (.ts/.tsx/index).
function resolveLocal(fromPath, spec) {
  if (!spec.startsWith(".")) return null; // zewnętrzny (node_modules)
  const base = join(dirname(fromPath), spec).replace(/\\/g, "/");
  for (const cand of [base, base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx"]) {
    if (known.has(cand)) return cand;
  }
  return null;
}

// Bazowe nazwy plików testowych (do powiązania testów z plikami).
const testedBase = new Set();
for (const r of raw) {
  const m = r.path.match(/([A-Za-z0-9_]+)\.test\.tsx?$/);
  if (m) testedBase.add(m[1].toLowerCase());
}
const baseName = (p) => (p.match(/([A-Za-z0-9_]+)\.tsx?$/)?.[1] || "").toLowerCase();

// --- Pass 2: graf uses + usedBy ---
const usesMap = new Map();
for (const r of raw) {
  const uses = [];
  for (const spec of importSpecsOf(r.src)) {
    const res = resolveLocal(r.path, spec);
    if (res && res !== r.path) uses.push(res);
  }
  usesMap.set(r.path, [...new Set(uses)]);
}
const usedByMap = new Map();
for (const [from, uses] of usesMap) for (const u of uses) {
  if (!usedByMap.has(u)) usedByMap.set(u, []);
  usedByMap.get(u).push(from);
}

// --- Ocena jakości (heurystyki) ---
function quality(entry) {
  const loc = entry.loc;
  const fanIn = (usedByMap.get(entry.path) || []).length;
  const complexity = loc > 800 ? "bardzo wysoka" : loc > 400 ? "wysoka" : loc > 150 ? "średnia" : "niska";
  const criticality = fanIn >= 12 ? "krytyczny" : fanIn >= 5 ? "wysoki" : fanIn >= 1 ? "średni" : "niski";
  // Plik ma testy, jeśli importuje go jakikolwiek plik *.test.* (dokładniejsze niż nazwa) lub
  // istnieje test o tej samej nazwie bazowej.
  const hasTests = entry.kind === "test"
    || (usedByMap.get(entry.path) || []).some((p) => /\.test\.tsx?$/.test(p))
    || testedBase.has(baseName(entry.path));
  const risk = (loc > 600 && fanIn >= 5) ? "wysokie" : (loc > 400 || fanIn >= 5) ? "średnie" : "niskie";
  const refactorPriority = loc > 1200 ? "pilny" : loc > 600 ? "wysoki" : loc > 300 ? "średni" : "niski";
  return { complexity, criticality, hasTests, risk, refactorPriority, fanIn };
}

const entries = raw.map((r) => {
  const e = {
    path: r.path,
    kind: kindOf(r.path),
    loc: r.src.split("\n").length,
    exports: exportsOf(r.src),
    summary: summaryOf(r.src),
    uses: usesMap.get(r.path) || [],
    usedBy: usedByMap.get(r.path) || [],
  };
  e.quality = quality(e);
  return e;
}).sort((a, b) => a.path.localeCompare(b.path));

const index = {
  generatedAtNote: "Wygenerowane przez scripts/gen-knowledge.mjs — uruchom 'npm run knowledge' po większych zmianach.",
  fileCount: entries.length,
  byKind: entries.reduce((acc, e) => { acc[e.kind] = (acc[e.kind] || 0) + 1; return acc; }, {}),
  files: entries,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(index, null, 2) + "\n");
console.log(`✅ ${OUT}: ${entries.length} plików (${Object.entries(index.byKind).map(([k, v]) => `${k}:${v}`).join(", ")})`);
