// Tabela statusów scenariuszy eval.md z wyników Playwright (EVIDENCE/e2e-latest.json).
// Mapowanie: plik sNN-*.spec.ts → scenariusz SNN. Scenariusz jest ZIELONY, gdy
// wszystkie jego testy przeszły; inaczej CZERWONY.
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync(new URL("../EVIDENCE/e2e-latest.json", import.meta.url), "utf-8"));
const byScenario = new Map();

function walk(suite) {
  for (const s of suite.suites || []) walk(s);
  for (const spec of suite.specs || []) {
    const m = /(?:^|\/)s(\d{2})-/.exec(spec.file || suite.file || "");
    if (!m) continue;
    const key = "S" + m[1];
    const okSoFar = byScenario.has(key) ? byScenario.get(key) : true;
    byScenario.set(key, okSoFar && spec.ok === true);
  }
}
for (const s of raw.suites || []) walk(s);

let green = 0;
const rows = [];
for (let i = 1; i <= 12; i++) {
  const key = "S" + String(i).padStart(2, "0");
  const status = byScenario.has(key) ? (byScenario.get(key) ? "ZIELONY" : "CZERWONY") : "BRAK TESTU";
  if (status === "ZIELONY") green++;
  rows.push(`${key}  ${status}`);
}
console.log(rows.join("\n"));
console.log(`---\nzielone: ${green}/12`);
