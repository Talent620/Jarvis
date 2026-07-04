#!/usr/bin/env node
/**
 * Skan sekretów — blokuje commit/dodanie realnych kluczy API.
 * Domyślnie skanuje TYLKO dodane linie ze staging (git diff --cached); z flagą --all
 * skanuje wszystkie śledzone pliki. Progi długości dobrane tak, by NIE blokować
 * placeholderów (np. "sk-or-v1-abc"), prefiksów w detekcji ("sk-ant-") ani docsów.
 *
 * Pominięcie pojedynczej linii: dopisz komentarz  secret-scan-allow
 */
import { execSync } from "node:child_process";

const PATTERNS = [
  { name: "OpenRouter", re: /sk-or-v1-[A-Za-z0-9]{24,}/ },
  { name: "Anthropic", re: /sk-ant-(?:api|sid)[A-Za-z0-9_-]{24,}/ },
  { name: "Google API", re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: "Groq", re: /gsk_[A-Za-z0-9]{40,}/ },
  { name: "OpenAI", re: /sk-(?:proj-)?[A-Za-z0-9]{40,}/ },
  { name: "Bearer token", re: /Bearer\s+[A-Za-z0-9._-]{30,}/ },
];
// Pliki, w których wzorce są CELOWO (testy/skan/detekcja) — nie skanujemy ich treści.
const SKIP = [/scripts\/secret-scan\.mjs$/, /tests\//, /SECURITY\.md$/, /\.githooks\//];

const all = process.argv.includes("--all");
const lines = [];
try {
  if (all) {
    const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const f of files) {
      if (SKIP.some((re) => re.test(f))) continue;
      let body = "";
      try { body = execSync(`git show :"${f}" 2>/dev/null || cat "${f}"`, { encoding: "utf8" }); } catch { continue; }
      body.split("\n").forEach((text, i) => lines.push({ file: f, n: i + 1, text }));
    }
  } else {
    // Dodane linie ze staging (format: +treść, z nagłówkami plików).
    const diff = execSync("git diff --cached --unified=0 --no-color", { encoding: "utf8" });
    let file = "";
    for (const raw of diff.split("\n")) {
      if (raw.startsWith("+++ b/")) { file = raw.slice(6); continue; }
      if (raw.startsWith("+") && !raw.startsWith("+++")) lines.push({ file, n: 0, text: raw.slice(1) });
    }
  }
} catch (e) {
  console.error("secret-scan: nie udało się odczytać gita:", e.message);
  process.exit(0); // nie blokuj, gdy brak gita (np. CI bez historii)
}

const hits = [];
for (const { file, n, text } of lines) {
  if (SKIP.some((re) => re.test(file))) continue;
  if (/secret-scan-allow/.test(text)) continue;
  for (const p of PATTERNS) {
    if (p.re.test(text)) hits.push({ file, n, name: p.name, text: text.trim().slice(0, 100) });
  }
}

if (hits.length) {
  console.error("\n🚫 SKAN SEKRETÓW: wykryto potencjalne klucze API — commit zablokowany.\n");
  for (const h of hits) console.error(`  • [${h.name}] ${h.file}${h.n ? ":" + h.n : ""}\n      ${h.text}`);
  console.error("\nUsuń sekret z kodu (użyj env/sekretów BFF). Jeśli to fałszywy alarm, dopisz w linii: secret-scan-allow\n");
  process.exit(1);
}
console.log("✅ Skan sekretów: czysto.");
process.exit(0);
