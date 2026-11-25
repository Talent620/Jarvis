/**
 * JARVIS FORGE — Repository Intelligence (Repo Map + Dependency Graph + Stack/Test Detector).
 *
 * Wzorzec inspirowany Aider RepoMap (graf zależności + ranking istotności) w czystym Node.js 22:
 * - Zero zewnętrznych zależności (działa na dowolnym repozytorium TS/JS/Python/Go/Rust/JSON).
 * - Respektuje .gitignore i wyklucza katalogi build/vendor/binaria.
 * - Buduje graf importów (edges, fanIn, fanOut), wyodrębnia symbole (eksporty, klasy, funkcje, typy)
 *   i rankuje pliki względem celu zadania, mieszcząc mapę w zadanym budżecie znaków (idealne pod
 *   ciasne limity TPM darmowych API jak Groq 8K TPM i lokalną Ollamę!).
 * - Automatycznie wykrywa komendy test/lint/typecheck/build oraz zasady projektu z AGENTS.md.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const IGNORED_DIRS = new Set([
  ".git", "node_modules", "dist", "dist-studio", "build", "out", "coverage",
  ".next", ".nuxt", ".svelte-kit", ".vite", ".turbo", ".cache", ".jarvis-forge",
  ".jarvis", "__pycache__", ".venv", "venv", "target", ".gradle", ".idea",
  "vendor", "Pods",
]);

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".c", ".cpp", ".h",
  ".css", ".scss", ".html", ".sql", ".sh", ".json", ".yaml", ".yml", ".toml", ".md",
]);

const MAX_FILE_BYTES = 260_000;
const MAX_SCAN_FILES = 6000;

function readGitIgnorePatterns(repoRoot) {
  const ignoreFile = path.join(repoRoot, ".gitignore");
  if (!fs.existsSync(ignoreFile)) return [];
  try {
    return fs.readFileSync(ignoreFile, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
      .map((pattern) => {
        const clean = pattern.replace(/^\//, "").replace(/\/$/, "");
        return clean;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function matchesSimpleIgnore(relPosix, patterns) {
  for (const pat of patterns) {
    if (pat.includes("*")) {
      const escaped = pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
      if (new RegExp(`(^|/)${escaped}(/|$)`).test(relPosix)) return true;
    } else if (relPosix === pat || relPosix.startsWith(`${pat}/`) || relPosix.includes(`/${pat}/`)) {
      return true;
    }
  }
  return false;
}

function isProbablyBinary(buf) {
  const len = Math.min(buf.length, 2048);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** Wyodrębnij symbole i ścieżki importów z pliku źródłowego. */
export function extractSymbolsAndImports(relPath, content) {
  const ext = path.extname(relPath).toLowerCase();
  const symbols = [];
  const imports = [];
  const lines = content.split(/\r?\n/);

  const pushSym = (name, kind, line) => {
    if (!name || symbols.length >= 60) return;
    if (!symbols.some((s) => s.name === name && s.kind === kind)) {
      symbols.push({ name, kind, line });
    }
  };

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;
      // Importy ESM / re-eksporty
      const imp = line.match(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/);
      if (imp && imp[1]) imports.push(imp[1]);
      // require(...)
      const req = line.match(/\brequire\(\s*["']([^"']+)["']\s*\)/);
      if (req && req[1]) imports.push(req[1]);
      // Eksportowane i główne deklaracje
      const fn = line.match(/^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (fn) pushSym(fn[1], "fn", ln);
      const cls = line.match(/^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (cls) pushSym(cls[1], "class", ln);
      const iface = line.match(/^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (iface) pushSym(iface[1], "type", ln);
      const expConst = line.match(/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (expConst) pushSym(expConst[1], "export", ln);
    }
  } else if (ext === ".py") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;
      const imp = line.match(/^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/);
      if (imp) imports.push(imp[1] || imp[2]);
      const fn = line.match(/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (fn) pushSym(fn[1], "fn", ln);
      const cls = line.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (cls) pushSym(cls[1], "class", ln);
    }
  } else if (ext === ".go") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;
      const fn = line.match(/^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)/);
      if (fn) pushSym(fn[1], "fn", ln);
      const ty = line.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:struct|interface)/);
      if (ty) pushSym(ty[1], "type", ln);
    }
  } else if (ext === ".rs") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;
      const fn = line.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (fn) pushSym(fn[1], "fn", ln);
      const ty = line.match(/^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (ty) pushSym(ty[1], "type", ln);
    }
  } else if (relPath.endsWith("package.json")) {
    try {
      const pkg = JSON.parse(content);
      for (const s of Object.keys(pkg.scripts || {}).slice(0, 20)) pushSym(`script:${s}`, "script", 1);
    } catch { /* ignore invalid json */ }
  }

  return {
    symbols,
    imports: [...new Set(imports)],
    lineCount: lines.length,
  };
}

function resolveLocalImport(fromRel, spec, fileSet) {
  if (!spec || (!spec.startsWith(".") && !spec.startsWith("/"))) return null;
  const baseDir = path.posix.dirname(fromRel);
  const raw = path.posix.normalize(path.posix.join(baseDir, spec));
  const candidates = [
    raw,
    `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, `${raw}.jsx`, `${raw}.mjs`, `${raw}.cjs`, `${raw}.py`,
    `${raw}/index.ts`, `${raw}/index.tsx`, `${raw}/index.js`, `${raw}/index.mjs`, `${raw}/index.cjs`,
  ];
  // Obsługa importów TypeScript zapisywanych jako `.js` dla źródła `.ts`
  if (raw.endsWith(".js")) {
    candidates.unshift(raw.slice(0, -3) + ".ts", raw.slice(0, -3) + ".tsx");
  }
  for (const cand of candidates) {
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

function safeGit(repoRoot, args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

/** Wykryj stack technologiczny, komendy weryfikacyjne, stan Git i reguły projektu. */
export function detectProjectProfile(repoRoot) {
  const root = path.resolve(repoRoot);
  const profile = {
    root,
    name: path.basename(root),
    languages: [],
    packageManager: null,
    testCommands: [],
    lintCommands: [],
    typecheckCommands: [],
    buildCommands: [],
    projectRules: [],
    git: {
      isRepo: false,
      branch: null,
      head: null,
      dirty: false,
    },
  };

  const head = safeGit(root, ["rev-parse", "--short", "HEAD"]);
  if (head) {
    profile.git.isRepo = true;
    profile.git.head = head;
    profile.git.branch = safeGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const status = safeGit(root, ["status", "--porcelain=v1"]);
    profile.git.dirty = Boolean(status && status.length > 0);
  }

  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.name) profile.name = String(pkg.name);
      const scripts = pkg.scripts || {};
      const pm = fs.existsSync(path.join(root, "pnpm-lock.yaml"))
        ? "pnpm"
        : fs.existsSync(path.join(root, "yarn.lock"))
          ? "yarn"
          : "npm";
      profile.packageManager = pm;
      const runPrefix = pm === "npm" ? ["run"] : [];

      if (scripts.test && !/no test specified/i.test(String(scripts.test))) {
        profile.testCommands.push({ command: pm, args: pm === "npm" ? ["test"] : ["test"], label: `${pm} test` });
      }
      if (scripts.lint) {
        profile.lintCommands.push({ command: pm, args: [...runPrefix, "lint"], label: `${pm} run lint` });
      }
      if (scripts.typecheck) {
        profile.typecheckCommands.push({ command: pm, args: [...runPrefix, "typecheck"], label: `${pm} run typecheck` });
      } else if (fs.existsSync(path.join(root, "tsconfig.json"))) {
        profile.typecheckCommands.push({ command: "npx", args: ["tsc", "--noEmit"], label: "npx tsc --noEmit" });
      }
      if (scripts.build) {
        profile.buildCommands.push({ command: pm, args: [...runPrefix, "build"], label: `${pm} run build` });
      }
    } catch { /* ignore broken package.json */ }
  }

  if (fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "pytest.ini"))) {
    profile.languages.push("python");
    profile.testCommands.push({ command: "pytest", args: ["-q"], label: "pytest -q" });
  }
  if (fs.existsSync(path.join(root, "go.mod"))) {
    profile.languages.push("go");
    profile.testCommands.push({ command: "go", args: ["test", "./..."], label: "go test ./..." });
  }
  if (fs.existsSync(path.join(root, "Cargo.toml"))) {
    profile.languages.push("rust");
    profile.testCommands.push({ command: "cargo", args: ["test"], label: "cargo test" });
  }

  // Odczytaj kluczowe reguły z AGENTS.md / CLAUDE.md (jeśli istnieją)
  for (const docName of ["AGENTS.md", "CLAUDE.md"]) {
    const docPath = path.join(root, docName);
    if (!fs.existsSync(docPath)) continue;
    try {
      const txt = fs.readFileSync(docPath, "utf8");
      if (/es2019|chrome 79|lookbehind/i.test(txt)) {
        profile.projectRules.push("Cel ES2019 / Chrome 79: w kodzie src/ nie używaj regex lookbehind ani \\p{...}.");
      }
      if (/nie zmieniaj testów po to, by przeszły/i.test(txt)) {
        profile.projectRules.push("Nie osłabiaj istniejących testów po to, by przeszły — napraw przyczynę źródłową.");
      }
      if (/secret-scan/i.test(txt)) {
        profile.projectRules.push("Nigdy nie umieszczaj kluczy API, tokenów ani sekretów w kodzie ani logach.");
      }
    } catch { /* ignore */ }
  }

  return profile;
}

/** Zeskanuj repozytorium i zbuduj indeks plików, symboli oraz grafu zależności. */
export function scanRepository(repoRoot, opts = {}) {
  const root = path.resolve(repoRoot);
  const maxFiles = opts.maxFiles ?? MAX_SCAN_FILES;
  const prevByPath = new Map((opts.previousIndex?.files || []).map((f) => [f.path, f]));
  const ignorePatterns = readGitIgnorePatterns(root);
  const files = [];
  const extCounts = new Map();
  let truncated = false;

  const walk = (dir) => {
    if (files.length >= maxFiles) { truncated = true; return; }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) { truncated = true; break; }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      const relPosix = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || matchesSimpleIgnore(relPosix, ignorePatterns)) continue;
        walk(full);
      } else if (entry.isFile()) {
        if (matchesSimpleIgnore(relPosix, ignorePatterns)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!CODE_EXTS.has(ext) && entry.name !== "Makefile" && entry.name !== "Dockerfile") continue;
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) continue;

        const prev = prevByPath.get(relPosix);
        if (prev && prev.mtimeMs === stat.mtimeMs && prev.bytes === stat.size) {
          files.push({
            path: relPosix,
            ext,
            bytes: stat.size,
            mtimeMs: stat.mtimeMs,
            lineCount: prev.lineCount,
            symbols: prev.symbols,
            rawImports: prev.rawImports,
            imports: [],
            importedBy: [],
          });
          extCounts.set(ext || entry.name, (extCounts.get(ext || entry.name) || 0) + 1);
          continue;
        }

        let buf;
        try {
          buf = fs.readFileSync(full);
        } catch {
          continue;
        }
        if (isProbablyBinary(buf)) continue;
        const content = buf.toString("utf8");
        const parsed = extractSymbolsAndImports(relPosix, content);
        files.push({
          path: relPosix,
          ext,
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
          lineCount: parsed.lineCount,
          symbols: parsed.symbols,
          rawImports: parsed.imports,
          imports: [],
          importedBy: [],
        });
        extCounts.set(ext || entry.name, (extCounts.get(ext || entry.name) || 0) + 1);
      }
    }
  };

  walk(root);

  const byPath = new Map(files.map((f) => [f.path, f]));
  const fileSet = new Set(byPath.keys());
  let edgeCount = 0;

  for (const file of files) {
    const resolved = [];
    for (const spec of file.rawImports) {
      const target = resolveLocalImport(file.path, spec, fileSet);
      if (target && target !== file.path) {
        resolved.push(target);
        const targetNode = byPath.get(target);
        if (targetNode && !targetNode.importedBy.includes(file.path)) {
          targetNode.importedBy.push(file.path);
          edgeCount += 1;
        }
      }
    }
    file.imports = [...new Set(resolved)];
  }

  // Prosta iteracja PageRank (6 kroków) po grafie zależności — wyłania architektoniczne filary projektu.
  const n = Math.max(1, files.length);
  const rank = new Map(files.map((f) => [f.path, 1 / n]));
  const d = 0.85;
  for (let iter = 0; iter < 6; iter++) {
    const next = new Map(files.map((f) => [f.path, (1 - d) / n]));
    for (const f of files) {
      const out = f.imports.length;
      if (!out) continue;
      const share = (d * (rank.get(f.path) || 0)) / out;
      for (const target of f.imports) {
        next.set(target, (next.get(target) || 0) + share);
      }
    }
    for (const [k, v] of next) rank.set(k, v);
  }
  for (const f of files) {
    f.centrality = Number(((rank.get(f.path) || 0) * n).toFixed(3));
  }

  const profile = detectProjectProfile(root);
  const langMap = {
    ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
    ".mjs": "javascript", ".cjs": "javascript", ".py": "python", ".go": "go", ".rs": "rust",
  };
  const langs = new Set(profile.languages);
  for (const [ext] of extCounts) {
    if (langMap[ext]) langs.add(langMap[ext]);
  }
  profile.languages = [...langs];

  // Top 15 kluczowych modułów (najwyższy fan-in / centrality)
  const coreModules = [...files]
    .filter((f) => !/(^|\/)(test|tests|__tests__)\//i.test(f.path))
    .sort((a, b) => (b.importedBy.length - a.importedBy.length) || (b.centrality - a.centrality))
    .slice(0, 15)
    .map((f) => ({
      path: f.path,
      fanIn: f.importedBy.length,
      fanOut: f.imports.length,
      centrality: f.centrality,
      symbols: f.symbols.slice(0, 6).map((s) => s.name),
    }));

  return {
    scannedAt: new Date().toISOString(),
    repoRoot: root,
    profile,
    totalFiles: files.length,
    truncated,
    edgeCount,
    coreModules,
    files,
  };
}

function tokenizeQuery(text) {
  return [...new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9_/-]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2),
  )];
}

/**
 * Analiza wpływu zmian (Change Impact Analysis):
 * Wyznacza bezpośrednich i pośrednich (2-hop) konsumentów zmodyfikowanych plików oraz powiązane pliki testowe.
 */
export function analyzeChangeImpact(index, modifiedPaths = []) {
  const byPath = new Map((index?.files || []).map((f) => [f.path, f]));
  const modifiedSet = new Set(modifiedPaths.map((p) => String(p || "").replace(/\\/g, "/")));
  const directImporters = new Set();
  const transitiveImporters = new Set();
  const affectedTests = new Set();

  const isTestFile = (p) => /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[a-z]+$|_test\.py$|^test_.*\.py$/i.test(p);

  for (const rel of modifiedSet) {
    if (isTestFile(rel)) affectedTests.add(rel);
    const node = byPath.get(rel);
    if (!node) continue;
    for (const imp of node.importedBy || []) {
      if (!modifiedSet.has(imp)) directImporters.add(imp);
      if (isTestFile(imp)) affectedTests.add(imp);
      const depNode = byPath.get(imp);
      for (const imp2 of depNode?.importedBy || []) {
        if (!modifiedSet.has(imp2) && !directImporters.has(imp2)) transitiveImporters.add(imp2);
        if (isTestFile(imp2)) affectedTests.add(imp2);
      }
    }
    // Dopasowanie nazw testów odpowiadających zmienionemu modułowi (np. foo.js -> tests/foo.test.js)
    const stem = path.posix.basename(rel, path.posix.extname(rel)).toLowerCase();
    if (stem.length >= 3) {
      for (const f of index.files || []) {
        if (isTestFile(f.path) && f.path.toLowerCase().includes(stem)) {
          affectedTests.add(f.path);
        }
      }
    }
  }

  const blastRadius = directImporters.size + transitiveImporters.size;
  const riskLevel = blastRadius >= 15 ? "high" : blastRadius >= 4 ? "medium" : "low";
  return {
    modifiedFiles: [...modifiedSet],
    directImporters: [...directImporters].slice(0, 30),
    transitiveImporters: [...transitiveImporters].slice(0, 30),
    affectedTests: [...affectedTests].slice(0, 20),
    blastRadius,
    riskLevel,
  };
}

/**
 * Zbuduj kompaktową Mapę Repozytorium dopasowaną do celu zadania (Aider-inspired).
 * Łączy dopasowanie słów kluczowych (ścieżka + symbole) z centralnością grafu i sąsiedztwem 1-hop.
 */
export function buildRepoMap(index, opts = {}) {
  const query = opts.query || "";
  const maxChars = Math.max(1200, opts.maxChars ?? 6000);
  const focusFiles = new Set((opts.focusFiles || []).map((f) => String(f).replace(/\\/g, "/")));
  const terms = tokenizeQuery(query);

  const scores = new Map();
  for (const f of index.files) {
    let score = f.centrality * 1.5 + Math.min(8, f.importedBy.length * 0.6);
    if (focusFiles.has(f.path)) score += 30;
    const pLow = f.path.toLowerCase();
    for (const t of terms) {
      if (pLow.includes(t)) score += 8;
      for (const s of f.symbols) {
        if (s.name.toLowerCase().includes(t)) score += 5;
      }
    }
    if (/(^|\/)package\.json$/.test(f.path)) score += 6;
    scores.set(f.path, score);
  }

  // Wzmocnij bezpośrednich sąsiadów (1-hop) najlepiej dopasowanych plików
  const topSeeds = [...index.files]
    .sort((a, b) => (scores.get(b.path) || 0) - (scores.get(a.path) || 0))
    .slice(0, 8);
  for (const seed of topSeeds) {
    if ((scores.get(seed.path) || 0) < 8) continue;
    for (const dep of seed.imports) scores.set(dep, (scores.get(dep) || 0) + 4);
    for (const rev of seed.importedBy) scores.set(rev, (scores.get(rev) || 0) + 3);
  }

  const ranked = [...index.files].sort((a, b) => (scores.get(b.path) || 0) - (scores.get(a.path) || 0));

  const lines = [
    `# Repo Map: ${index.profile.name} (${index.totalFiles} plików${index.truncated ? " [obcięto]" : ""}, ${index.edgeCount} krawędzi zależności)`,
    `Języki: ${index.profile.languages.join(", ") || "nieznane"} · Git: ${index.profile.git.isRepo ? `${index.profile.git.branch || "detached"}@${index.profile.git.head}${index.profile.git.dirty ? " (dirty)" : ""}` : "brak"}`,
  ];
  if (index.profile.testCommands.length) {
    lines.push(`Testy: ${index.profile.testCommands.map((c) => c.label).join(", ")}`);
  }
  if (index.profile.typecheckCommands.length) {
    lines.push(`Typecheck: ${index.profile.typecheckCommands.map((c) => c.label).join(", ")}`);
  }
  if (index.profile.lintCommands.length) {
    lines.push(`Lint: ${index.profile.lintCommands.map((c) => c.label).join(", ")}`);
  }
  if (index.profile.projectRules.length) {
    lines.push(`Reguły: ${index.profile.projectRules.join(" | ")}`);
  }
  lines.push("");

  let used = lines.join("\n").length;
  const included = [];
  for (const f of ranked) {
    const syms = f.symbols.slice(0, 10).map((s) => `${s.name}:${s.line}`).join(", ");
    const deps = f.imports.slice(0, 5).join(", ");
    const row = `- ${f.path} (${f.lineCount}L, fanIn:${f.importedBy.length})${syms ? ` · [${syms}]` : ""}${deps ? ` -> {${deps}}` : ""}`;
    if (used + row.length + 1 > maxChars) break;
    lines.push(row);
    used += row.length + 1;
    included.push(f.path);
  }

  return {
    text: lines.join("\n"),
    includedFiles: included,
    topCandidates: ranked.slice(0, 12).map((f) => ({
      path: f.path,
      score: Number((scores.get(f.path) || 0).toFixed(2)),
      fanIn: f.importedBy.length,
      symbols: f.symbols.slice(0, 8).map((s) => s.name),
    })),
  };
}
