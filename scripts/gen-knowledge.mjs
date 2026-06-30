// === Generator bazy wiedzy o projekcie (Project Knowledge Engine — ETAP 3) ===
// Skanuje src/ i tworzy indeks plików (ścieżka, rodzaj, eksporty, LOC, krótki opis z komentarza).
// Wynik: audit/knowledge-index.json — odczytywany przez Developer Copilota (src/lib/knowledge.ts).
// Uruchom: npm run knowledge   (albo: node scripts/gen-knowledge.mjs)
//
// PROJEKT: czysty Node, zero zależności runtime. Parsowanie regexem (lekkie, best-effort) — to
// indeks nawigacyjny, nie pełny AST. Idempotentny: nadpisuje plik wynikowy.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";

/** Rodzaj pliku po lokalizacji/nazwie. */
function kindOf(path) {
  if (/\.test\.tsx?$/.test(path)) return "test";
  if (path.includes("/components/")) return "component";
  if (path.includes("/hooks/")) return "hook";
  if (path.includes("/plugins/")) return "plugin";
  if (path.includes("/lib/")) return "lib";
  return "other";
}

/** Wyłuskaj nazwy eksportów (best-effort). */
function exportsOf(src) {
  const out = new Set();
  const re = /export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  if (/export\s+default/.test(src)) out.add("default");
  return [...out];
}

/** Krótki opis: pierwszy blok komentarza // na górze pliku albo pierwszy /** */
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

const entries = [];
function walk(dir) {
  let items;
  try { items = readdirSync(dir); } catch { return; }
  for (const name of items) {
    const path = join(dir, name);
    let st;
    try { st = statSync(path); } catch { continue; }
    if (st.isDirectory()) { walk(path); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    let src = "";
    try { src = readFileSync(path, "utf8"); } catch { continue; }
    entries.push({
      path: path.replace(/\\/g, "/"),
      kind: kindOf(path.replace(/\\/g, "/")),
      loc: src.split("\n").length,
      exports: exportsOf(src),
      summary: summaryOf(src),
    });
  }
}
walk(ROOT);
entries.sort((a, b) => a.path.localeCompare(b.path));

const index = {
  generatedAtNote: "Wygenerowane przez scripts/gen-knowledge.mjs — uruchom 'npm run knowledge' po większych zmianach.",
  fileCount: entries.length,
  byKind: entries.reduce((acc, e) => { acc[e.kind] = (acc[e.kind] || 0) + 1; return acc; }, {}),
  files: entries,
};

writeFileSync("audit/knowledge-index.json", JSON.stringify(index, null, 2) + "\n");
console.log(`✅ knowledge-index.json: ${entries.length} plików (${Object.entries(index.byKind).map(([k, v]) => `${k}:${v}`).join(", ")})`);
