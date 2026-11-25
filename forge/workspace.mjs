/**
 * JARVIS FORGE — Agent-Computer Interface (ACI) dla pracy na dowolnym repozytorium.
 *
 * Wzorce SWE-agent + Aider + Claude Code:
 * - Twarda granica katalogu (`insideRoot` z `realpathSync`), skaner sekretów przy zapisie.
 * - Paginowany odczyt z numeracją linii (`read_file`), szybkie przeszukiwanie (`search_code`),
 *   dynamiczna mapa repo (`repo_map`), chirurgiczna edycja `SEARCH/REPLACE` (`edit_file`)
 *   z natychmiastową walidacją składni (`node --check` / `JSON.parse`) i realnym unified diffem.
 * - Bezpieczne `run_command` bez `shell: true`, z zabijaniem całego drzewa procesów po timeout
 *   i strukturalnym parserem błędów (plik, linia, znormalizowana sygnatura błędu).
 * - Migawki (snapshots) przed pierwszą edycją każdego pliku → deterministyczny `rollbackRun()`.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { atomicWriteFile, insideRoot, redactSecrets, scanSecretsInText, shortHash } from "./security.mjs";
import { buildRepoMap, scanRepository } from "./repo-intel.mjs";

export const ALLOWED_DEV_COMMANDS = new Set([
  "node", "npm", "npx", "pnpm", "yarn", "git",
  "python3", "python", "pytest", "go", "cargo", "make", "rg", "sqlite3", "docker",
]);

const DESTRUCTIVE_ARG_PATTERNS = [
  /(?:^|\s)--force(?:\s|$)/i,
  /(?:^|\s)reset\s+--hard(?:\s|$)/i,
  /(?:^|\s)clean\s+-[a-z]*f/i,
  /(?:^|\s)push(?:\s|$)/i,
  /(?:^|\s)rm\s+-rf/i,
  /(?:^|\s)(?:shutdown|reboot|mkfs|dd\s+if=)/i,
];

const MAX_CMD_OUTPUT = 180_000;
const MAX_READ_BYTES = 1_500_000;

/** Wygeneruj zwięzły unified diff między dwiema wersjami pliku tekstowego (bez zewnętrznego `diff`). */
export function computeUnifiedDiff(relPath, beforeText, afterText, contextLines = 3) {
  const a = String(beforeText ?? "").split(/\r?\n/);
  const b = String(afterText ?? "").split(/\r?\n/);
  if (beforeText === afterText) return "";

  // Prosty LCS / prefiks-sufiks dla szybkiego, deterministycznego diffu bez kwadratowej pamięci na dużych plikach
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const aStart = Math.max(0, prefix - contextLines);
  const bStart = Math.max(0, prefix - contextLines);
  const aMidEnd = a.length - suffix;
  const bMidEnd = b.length - suffix;
  const aEnd = Math.min(a.length, aMidEnd + contextLines);
  const bEnd = Math.min(b.length, bMidEnd + contextLines);

  const out = [
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
    `@@ -${aStart + 1},${Math.max(0, aEnd - aStart)} +${bStart + 1},${Math.max(0, bEnd - bStart)} @@`,
  ];
  for (let i = aStart; i < prefix; i++) out.push(` ${a[i]}`);
  for (let i = prefix; i < aMidEnd; i++) out.push(`-${a[i]}`);
  for (let i = prefix; i < bMidEnd; i++) out.push(`+${b[i]}`);
  for (let i = aMidEnd; i < aEnd; i++) out.push(` ${a[i]}`);
  return out.join("\n").slice(0, 12_000);
}

/** Sprawdź składnię pliku natychmiast po zapisie (ACI lint-on-edit). */
export function quickSyntaxCheck(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".json") {
    try {
      JSON.parse(fs.readFileSync(absPath, "utf8"));
      return { ok: true, checker: "json-parse" };
    } catch (e) {
      return { ok: false, checker: "json-parse", error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (ext === ".mjs" || ext === ".cjs" || ext === ".js") {
    const res = spawnSync(process.execPath, ["--check", absPath], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
    if (res.status === 0) return { ok: true, checker: "node --check" };
    return { ok: false, checker: "node --check", error: (res.stderr || res.stdout || "SyntaxError").trim().slice(0, 1200) };
  }
  return { ok: true, checker: "none" };
}

const ANSI_STRIP_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/** Wyodrębnij znormalizowaną sygnaturę błędu z wyjścia komendy (do anti-loop i pamięci doświadczeń). */
export function extractErrorSignature(output, command = "") {
  const clean = String(output || "")
    .replace(ANSI_STRIP_RE, "")
    .trim();
  if (!clean) return { signature: `${command}:empty-failure`, summary: "Polecenie zakończone błędem bez wyjścia.", files: [] };

  const lines = clean.split(/\r?\n/);
  const errorLines = lines.filter((l) =>
    /(?:Error:|FAIL\s|AssertionError|TypeError|ReferenceError|SyntaxError|error TS\d+|✗|×|Expected:|Received:|Traceback|panic:)/i.test(l),
  );
  const picked = (errorLines.length ? errorLines : lines.slice(-12)).slice(0, 8);
  const rawSummary = picked.join("\n").slice(0, 900);

  // Wyciągnij pliki wspomniane w błędach
  const fileMatches = new Set();
  for (const l of picked) {
    const m = l.match(/([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs))(?::(\d+))?/);
    if (m && m[1] && !m[1].includes("node_modules")) fileMatches.add(m[1]);
  }

  // Znormalizuj zmienne (timestamp, porty, numery ms, ścieżki tmp) aby ta sama klasa błędu miała stały podpis
  const normalized = picked
    .slice(0, 3)
    .join(" | ")
    .replace(/\b\d+ms\b/g, "<ms>")
    .replace(/:\d+:\d+/g, ":<line>:<col>")
    .replace(/\/tmp\/[A-Za-z0-9._-]+/g, "<tmp>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  return {
    signature: `${command}:${shortHash(normalized, 10)}:${normalized.slice(0, 100)}`,
    summary: rawSummary,
    files: [...fileMatches].slice(0, 8),
  };
}

/** Przytnij długie wyjście terminala zachowując początek, środek błędów i koniec (oszczędza okno kontekstu!). */
export function condenseCommandOutput(stdout, stderr, maxChars = 6000) {
  const combined = [stdout, stderr ? `\n--- STDERR ---\n${stderr}` : ""].join("").trim();
  const redacted = redactSecrets(combined).text;
  if (redacted.length <= maxChars) return redacted;
  const headLen = Math.floor(maxChars * 0.3);
  const tailLen = Math.floor(maxChars * 0.55);
  return `${redacted.slice(0, headLen)}\n\n... [skondensowano ${redacted.length - headLen - tailLen} znaków] ...\n\n${redacted.slice(-tailLen)}`;
}

/** Bezpieczne uruchomienie procesu potomnego z zabijaniem grupy procesów przy timeout. */
export function runSafeProcess(command, args = [], opts = {}) {
  const cmd = String(command || "").trim();
  if (!ALLOWED_DEV_COMMANDS.has(cmd)) {
    return Promise.resolve({
      ok: false,
      code: -1,
      stdout: "",
      stderr: `Polecenie "${cmd}" nie znajduje się na allowliście narzędzi deweloperskich Forge.`,
      durationMs: 0,
      timedOut: false,
    });
  }
  const argList = (Array.isArray(args) ? args : []).map(String).slice(0, 60);
  const joined = `${cmd} ${argList.join(" ")}`;
  for (const pat of DESTRUCTIVE_ARG_PATTERNS) {
    if (pat.test(joined)) {
      return Promise.resolve({
        ok: false,
        code: -1,
        stdout: "",
        stderr: `Argumenty polecenia "${cmd}" zostały zablokowane przez politykę bezpieczeństwa Forge (ochrona przed destrukcją / push).`,
        durationMs: 0,
        timedOut: false,
      });
    }
  }

  const timeoutMs = Math.min(300_000, Math.max(1000, opts.timeoutMs ?? 90_000));
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(cmd, argList, {
      cwd: opts.cwd,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", ...(opts.env || {}) },
    });

    const killTree = () => {
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        try { child.kill(); } catch { /* ignore */ }
      }
    };

    const finish = (code, extraErr = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      const finalStderr = extraErr ? `${stderr}\n${extraErr}`.trim() : stderr;
      resolve({
        ok: code === 0 && !timedOut,
        code: code ?? -1,
        stdout: redactSecrets(stdout).text,
        stderr: redactSecrets(finalStderr).text,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    };

    const onAbort = () => {
      killTree();
      finish(-1, "Anulowano przez użytkownika (Kill-Switch / Abort).");
    };
    if (opts.signal) {
      if (opts.signal.aborted) { onAbort(); return; }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
      finish(-1, `Przekroczono limit czasu (${Math.round(timeoutMs / 1000)} s).`);
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-MAX_CMD_OUTPUT);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-MAX_CMD_OUTPUT);
    });
    child.on("error", (err) => finish(-1, err.message));
    child.on("close", (code) => finish(code));
  });
}

/** Definicje narzędzi ACI udostępniane modelom LLM. */
export const FORGE_TOOL_SCHEMAS = [
  {
    name: "repo_map",
    description: "Pobierz kompaktową mapę repozytorium (pliki, symbole, graf zależności) dopasowaną do zapytania.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Słowa kluczowe zadania lub nazwy symboli" },
        focus_files: { type: "array", items: { type: "string" }, description: "Ścieżki plików priorytetowych" },
        max_chars: { type: "number", description: "Maksymalny rozmiar mapy w znakach (domyślnie 5500)" },
      },
    },
  },
  {
    name: "list_files",
    description: "Wyświetl pliki w repozytorium (opcjonalnie z prefiksem ścieżki lub fragmentem nazwy).",
    parameters: {
      type: "object",
      properties: {
        prefix: { type: "string", description: "Opcjonalny katalog/prefiks ścieżki" },
        pattern: { type: "string", description: "Opcjonalny fragment nazwy pliku" },
        limit: { type: "number", description: "Maks. liczba plików (domyślnie 120)" },
      },
    },
  },
  {
    name: "read_file",
    description: "Odczytaj fragment pliku z numerami linii. Zawsze czytaj plik przed jego edycją.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ścieżka względna do pliku" },
        start_line: { type: "number", description: "Linia początkowa (1-indexed, domyślnie 1)" },
        end_line: { type: "number", description: "Linia końcowa (domyślnie start_line + 199)" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_code",
    description: "Przeszukaj kod repozytorium po frazie lub wyrażeniu regularnym.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Szukany tekst lub wzorzec regex" },
        path_prefix: { type: "string", description: "Opcjonalne ograniczenie do podkatalogu" },
        max_results: { type: "number", description: "Limit trafień (domyślnie 40)" },
      },
      required: ["query"],
    },
  },
  {
    name: "edit_file",
    description: "Chirurgiczna edycja pliku metodą SEARCH/REPLACE. Zwraca unified diff i wynik natychmiastowej kontroli składni.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ścieżka względna pliku do edycji" },
        search: { type: "string", description: "Dokładny istniejący fragment do zastąpienia (dla pojedynczej edycji)" },
        replace: { type: "string", description: "Nowa treść zastępująca fragment search" },
        edits: {
          type: "array",
          description: "Opcjonalna lista wielu par { search, replace } w jednym pliku",
          items: {
            type: "object",
            properties: {
              search: { type: "string" },
              replace: { type: "string" },
            },
            required: ["search", "replace"],
          },
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Utwórz nowy plik lub zapisz pełną treść istniejącego pliku (z kopią migawkową i walidacją składni).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ścieżka względna pliku" },
        content: { type: "string", description: "Pełna treść pliku" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "delete_file",
    description: "Usuń plik wewnątrz repozytorium (zachowuje kopię migawkową do ewentualnego rollbacku).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ścieżka względna pliku do usunięcia" },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description: "Uruchom bezpieczne polecenie deweloperskie (testy, lint, typecheck, build, git status/diff, node, pytest).",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Program z allowlisty: node, npm, npx, pnpm, yarn, git, python3, pytest, go, cargo, make, rg" },
        args: { type: "array", items: { type: "string" }, description: "Argumenty polecenia" },
        cwd: { type: "string", description: "Opcjonalny podkatalog wewnątrz repo" },
        timeout_ms: { type: "number", description: "Limit czasu w ms (domyślnie 90000)" },
      },
      required: ["command"],
    },
  },
  {
    name: "git_diff",
    description: "Sprawdź bieżące zmiany Git (status i diff).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Opcjonalna ścieżka pliku" },
      },
    },
  },
  {
    name: "finish_task",
    description: "Zasygnalizuj zakończenie etapu implementacji i przejdź do obowiązkowej, niezależnej weryfikacji testami.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Krótkie podsumowanie wprowadzonych zmian" },
        verify_commands: {
          type: "array",
          description: "Opcjonalna lista komend weryfikacyjnych { command, args }",
          items: {
            type: "object",
            properties: {
              command: { type: "string" },
              args: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
      required: ["summary"],
    },
  },
];

/** Zastosuj pojedynczą lub wielokrotną operację SEARCH/REPLACE na treści pliku. */
export function applySearchReplaceEdits(original, edits) {
  let content = String(original ?? "");
  const list = Array.isArray(edits) ? edits : [];
  if (!list.length) throw new Error("Brak bloków edycji (podaj search/replace lub tablicę edits).");

  for (let idx = 0; idx < list.length; idx++) {
    const item = list[idx] || {};
    const search = String(item.search ?? "");
    const replace = String(item.replace ?? "");
    if (!search) throw new Error(`Edycja #${idx + 1}: pole 'search' nie może być puste.`);

    const first = content.indexOf(search);
    if (first !== -1) {
      const second = content.indexOf(search, first + search.length);
      if (second !== -1) {
        const line1 = content.slice(0, first).split("\n").length;
        const line2 = content.slice(0, second).split("\n").length;
        throw new Error(`Edycja #${idx + 1}: wzorzec 'search' występuje wielokrotnie (linie ${line1} i ${line2}). Dodaj 2–3 linie kontekstu.`);
      }
      content = content.slice(0, first) + replace + content.slice(first + search.length);
      continue;
    }

    // Fallback: dopasowanie ignorujące CRLF i końcowe spacje w liniach
    const norm = (s) => s.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, ""));
    const contentLines = content.replace(/\r\n/g, "\n").split("\n");
    const normContent = norm(content);
    const normSearch = norm(search);
    const matches = [];
    for (let i = 0; i <= normContent.length - normSearch.length; i++) {
      let ok = true;
      for (let j = 0; j < normSearch.length; j++) {
        if (normContent[i + j] !== normSearch[j]) { ok = false; break; }
      }
      if (ok) matches.push(i);
    }
    if (matches.length === 0) {
      throw new Error(`Edycja #${idx + 1}: nie znaleziono fragmentu 'search' w pliku. Odczytaj aktualną treść pliku przez read_file.`);
    }
    if (matches.length > 1) {
      throw new Error(`Edycja #${idx + 1}: fragment 'search' pasuje w wielu miejscach (linie ${matches.map((m) => m + 1).join(", ")}). Dodaj więcej kontekstu.`);
    }
    const at = matches[0];
    contentLines.splice(at, normSearch.length, ...replace.replace(/\r\n/g, "\n").split("\n"));
    content = contentLines.join("\n");
  }
  return content;
}

/** Utwórz bezpieczne środowisko ACI powiązane z repozytorium i konkretnym runId. */
export function createForgeWorkspace({ repoRoot, runId, storageDir }) {
  const root = path.resolve(repoRoot);
  const baseStorage = path.resolve(storageDir || path.join(root, ".jarvis-forge"));
  const snapshotDir = path.join(baseStorage, "snapshots", runId || "default");
  const snapshotManifestPath = path.join(snapshotDir, "manifest.json");

  let repoIndex = null;
  const modifiedMap = new Map(); // relPath -> { path, action, diff, bytes, syntaxOk, updatedAt }

  const loadSnapshotManifest = () => {
    try {
      return JSON.parse(fs.readFileSync(snapshotManifestPath, "utf8"));
    } catch {
      return { runId, repoRoot: root, files: {} };
    }
  };

  const saveSnapshotManifest = (manifest) => {
    atomicWriteFile(snapshotManifestPath, JSON.stringify(manifest, null, 2) + "\n");
  };

  const ensureSnapshot = (relPath, absPath) => {
    const manifest = loadSnapshotManifest();
    if (manifest.files[relPath]) return; // pierwsza kopia sprzed runu już istnieje
    const existed = fs.existsSync(absPath);
    if (existed) {
      const backupName = `${shortHash(relPath, 12)}-${path.basename(relPath)}`;
      fs.mkdirSync(snapshotDir, { recursive: true });
      fs.copyFileSync(absPath, path.join(snapshotDir, backupName));
      manifest.files[relPath] = { existed: true, backupName };
    } else {
      manifest.files[relPath] = { existed: false };
    }
    saveSnapshotManifest(manifest);
  };

  const getIndex = (forceRefresh = false) => {
    if (!repoIndex || forceRefresh) repoIndex = scanRepository(root);
    return repoIndex;
  };

  const recordFileChange = (relPath, action, beforeText, afterText, syntax) => {
    const diff = computeUnifiedDiff(relPath, beforeText, afterText);
    const entry = {
      path: relPath,
      action,
      diff,
      bytes: Buffer.byteLength(String(afterText ?? ""), "utf8"),
      syntaxOk: syntax.ok,
      syntaxError: syntax.ok ? undefined : syntax.error,
      updatedAt: new Date().toISOString(),
    };
    modifiedMap.set(relPath, entry);
    repoIndex = null; // odśwież indeks przy kolejnym zapytaniu
    return entry;
  };

  async function executeTool(name, rawArgs = {}, execOpts = {}) {
    const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
    try {
      if (name === "repo_map") {
        const idx = getIndex();
        const map = buildRepoMap(idx, {
          query: args.query || "",
          focusFiles: Array.isArray(args.focus_files) ? args.focus_files : [],
          maxChars: Number(args.max_chars) || 5500,
        });
        return { ok: true, map: map.text, includedFiles: map.includedFiles, topCandidates: map.topCandidates };
      }

      if (name === "list_files") {
        const idx = getIndex();
        const prefix = String(args.prefix || "").replace(/\\/g, "/").replace(/^\.\//, "");
        const pattern = String(args.pattern || "").toLowerCase();
        const limit = Math.min(300, Math.max(10, Number(args.limit) || 120));
        const filtered = idx.files
          .map((f) => f.path)
          .filter((p) => (!prefix || p.startsWith(prefix)) && (!pattern || p.toLowerCase().includes(pattern)));
        return { ok: true, total: filtered.length, files: filtered.slice(0, limit) };
      }

      if (name === "read_file") {
        const abs = insideRoot(root, args.path);
        const rel = path.relative(root, abs).split(path.sep).join("/");
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          return { ok: false, error: `Plik "${rel}" nie istnieje.` };
        }
        const stat = fs.statSync(abs);
        if (stat.size > MAX_READ_BYTES) {
          return { ok: false, error: `Plik "${rel}" przekracza limit odczytu (${stat.size} B).` };
        }
        const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
        const start = Math.max(1, Number(args.start_line) || 1);
        const end = Math.min(lines.length, Number(args.end_line) || start + 199);
        const slice = lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join("\n");
        return {
          ok: true,
          path: rel,
          totalLines: lines.length,
          startLine: start,
          endLine: end,
          content: redactSecrets(slice).text,
        };
      }

      if (name === "search_code") {
        const query = String(args.query || "").trim();
        if (!query) return { ok: false, error: "Podaj frazę wyszukiwania 'query'." };
        const prefix = String(args.path_prefix || "").replace(/\\/g, "/").replace(/^\.\//, "");
        const maxResults = Math.min(80, Math.max(5, Number(args.max_results) || 40));
        const idx = getIndex();
        let re;
        try {
          re = new RegExp(query, "i");
        } catch {
          re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        }
        const hits = [];
        for (const f of idx.files) {
          if (prefix && !f.path.startsWith(prefix)) continue;
          const abs = path.join(root, f.path);
          let txt;
          try {
            txt = fs.readFileSync(abs, "utf8");
          } catch { continue; }
          const lines = txt.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              hits.push({ path: f.path, line: i + 1, text: redactSecrets(lines[i].trim()).text.slice(0, 200) });
              if (hits.length >= maxResults) break;
            }
          }
          if (hits.length >= maxResults) break;
        }
        return { ok: true, query, count: hits.length, hits };
      }

      if (name === "edit_file") {
        const abs = insideRoot(root, args.path);
        const rel = path.relative(root, abs).split(path.sep).join("/");
        if (!fs.existsSync(abs)) {
          return { ok: false, error: `Plik "${rel}" nie istnieje — użyj write_file, aby go utworzyć.` };
        }
        const before = fs.readFileSync(abs, "utf8");
        const edits = Array.isArray(args.edits) && args.edits.length
          ? args.edits
          : [{ search: args.search, replace: args.replace }];
        const after = applySearchReplaceEdits(before, edits);
        const secrets = scanSecretsInText(after);
        if (secrets.length) {
          return { ok: false, error: `Zablokowano zapis pliku "${rel}": wykryto potencjalny sekret (${secrets.join(", ")}).` };
        }
        ensureSnapshot(rel, abs);
        atomicWriteFile(abs, after);
        const syntax = quickSyntaxCheck(abs);
        const change = recordFileChange(rel, "modified", before, after, syntax);
        return {
          ok: syntax.ok,
          path: rel,
          syntax,
          diff: change.diff,
          ...(syntax.ok ? {} : { error: `Zapisano, ale wykryto błąd składni (${syntax.checker}): ${syntax.error}` }),
        };
      }

      if (name === "write_file") {
        const abs = insideRoot(root, args.path);
        const rel = path.relative(root, abs).split(path.sep).join("/");
        const content = String(args.content ?? "");
        if (Buffer.byteLength(content, "utf8") > MAX_READ_BYTES) {
          return { ok: false, error: "Treść pliku przekracza bezpieczny limit 1.5 MB." };
        }
        const secrets = scanSecretsInText(content);
        if (secrets.length) {
          return { ok: false, error: `Zablokowano zapis pliku "${rel}": wykryto potencjalny sekret (${secrets.join(", ")}).` };
        }
        const existed = fs.existsSync(abs);
        const before = existed ? fs.readFileSync(abs, "utf8") : "";
        ensureSnapshot(rel, abs);
        atomicWriteFile(abs, content);
        const syntax = quickSyntaxCheck(abs);
        const change = recordFileChange(rel, existed ? "modified" : "created", before, content, syntax);
        return {
          ok: syntax.ok,
          path: rel,
          action: change.action,
          bytes: change.bytes,
          syntax,
          diff: change.diff,
          ...(syntax.ok ? {} : { error: `Błąd składni po zapisie (${syntax.checker}): ${syntax.error}` }),
        };
      }

      if (name === "delete_file") {
        const abs = insideRoot(root, args.path);
        const rel = path.relative(root, abs).split(path.sep).join("/");
        if (!fs.existsSync(abs)) return { ok: false, error: `Plik "${rel}" nie istnieje.` };
        const before = fs.readFileSync(abs, "utf8");
        ensureSnapshot(rel, abs);
        fs.rmSync(abs, { force: true });
        recordFileChange(rel, "deleted", before, "", { ok: true, checker: "none" });
        return { ok: true, path: rel, action: "deleted" };
      }

      if (name === "run_command") {
        const cwd = insideRoot(root, args.cwd || ".");
        const res = await runSafeProcess(args.command, args.args || [], {
          cwd,
          timeoutMs: Number(args.timeout_ms) || 90_000,
          signal: execOpts.signal,
        });
        const condensed = condenseCommandOutput(res.stdout, res.stderr, 5500);
        const errorInfo = res.ok ? null : extractErrorSignature(`${res.stdout}\n${res.stderr}`, `${args.command} ${(args.args || []).join(" ")}`.trim());
        return {
          ok: res.ok,
          code: res.code,
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          output: condensed,
          ...(errorInfo ? { errorSignature: errorInfo.signature, errorSummary: errorInfo.summary, errorFiles: errorInfo.files } : {}),
        };
      }

      if (name === "git_diff") {
        const status = await runSafeProcess("git", ["status", "--short"], { cwd: root, timeoutMs: 15_000 });
        const diffArgs = ["diff", "--stat"];
        if (args.path) diffArgs.push("--", path.relative(root, insideRoot(root, args.path)));
        const diff = await runSafeProcess("git", diffArgs, { cwd: root, timeoutMs: 15_000 });
        return {
          ok: status.ok && diff.ok,
          status: status.stdout,
          diffStat: diff.stdout,
        };
      }

      if (name === "finish_task") {
        return {
          ok: true,
          finishedRequested: true,
          summary: String(args.summary || ""),
          verifyCommands: Array.isArray(args.verify_commands) ? args.verify_commands : [],
        };
      }

      return { ok: false, error: `Nieznane narzędzie Forge: ${name}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Przywróć wszystkie pliki zmodyfikowane / utworzone / usunięte w ramach bieżącego runu. */
  function rollbackRun() {
    const manifest = loadSnapshotManifest();
    const restored = [];
    for (const [relPath, meta] of Object.entries(manifest.files || {})) {
      const abs = insideRoot(root, relPath);
      if (meta.existed && meta.backupName) {
        const src = path.join(snapshotDir, meta.backupName);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.copyFileSync(src, abs);
          restored.push({ path: relPath, action: "restored" });
        }
      } else if (!meta.existed && fs.existsSync(abs)) {
        fs.rmSync(abs, { force: true });
        restored.push({ path: relPath, action: "removed_created" });
      }
    }
    modifiedMap.clear();
    repoIndex = null;
    return { ok: true, restoredCount: restored.length, restored };
  }

  return {
    root,
    getIndex,
    executeTool,
    rollbackRun,
    getModifiedFiles: () => [...modifiedMap.values()],
  };
}
