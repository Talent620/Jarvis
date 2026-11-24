/**
 * JARVIS — Project Memory (Sprint 5a, Development Guardian foundation).
 *
 * Czysta biblioteka bez zależności zewnętrznych. Używana przez:
 *   - scripts/sync-project-state.mjs  (generator CURRENT_STATE.json / .md + rejestrator testów)
 *   - scripts/agent-event.mjs         (odporny dziennik zdarzeń agentów)
 *   - tests/projectMemory.test.ts
 *
 * Zasady twarde:
 *   - PASS wyłącznie z rzeczywistego uruchomienia (kod wyjścia 0, ten sam commit i ten sam stan drzewa).
 *   - Brak danych = UNKNOWN, nigdy sukces.
 *   - Wszystko, co trafia na dysk, przechodzi przez redactDeep() (sekrety → [REDACTED:<rodzaj>]).
 *   - Zdarzenia: jeden plik na zdarzenie, tworzony atomowo i wyłącznie (link() → EEXIST), bez dopisywania.
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MEMORY_DIR = "project-memory";
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const LOCK_STALE_MS = 10 * 60 * 1000;
export const MD_MAX_LINES = 100;
export const STATUSES = ["PASS", "FAIL", "STALE", "UNKNOWN"];

const P = (root, ...parts) => path.join(root, MEMORY_DIR, ...parts);

// ───────────────────────────── Redakcja sekretów ─────────────────────────────

const SECRET_PATTERNS = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ["openrouter", /sk-or-v1-[A-Za-z0-9]{16,}/g],
  ["anthropic", /sk-ant-[A-Za-z0-9_-]{16,}/g],
  ["openai", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ["google", /AIza[0-9A-Za-z_-]{30,}/g],
  ["groq", /\bgsk_[A-Za-z0-9]{20,}/g],
  ["github", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g],
  ["github-pat", /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ["modal-token", /\b(?:ak|as)-[A-Za-z0-9]{16,}\b/g],
  ["vllm", /\bjvllm_[A-Za-z0-9]{8,}\b/g],
  ["slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["aws", /\bAKIA[0-9A-Z]{16}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["bearer", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g],
  ["url-credentials", /(?<=:\/\/)[^/\s:@]+:[^/\s@]+(?=@)/g],
];
// NAZWA_Z_KEY/TOKEN/SECRET/PASSWORD = wartość → zachowaj nazwę, zredaguj wartość.
const ASSIGNMENT_RE = /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"'$]{8,})\3/g;

/** Zredaguj sekrety w tekście. Zwraca { text, count }. */
export function redactString(input) {
  if (typeof input !== "string" || !input) return { text: input, count: 0 };
  let text = input;
  let count = 0;
  for (const [kind, re] of SECRET_PATTERNS) {
    text = text.replace(re, () => {
      count++;
      return `[REDACTED:${kind}]`;
    });
  }
  text = text.replace(ASSIGNMENT_RE, (m, name, sep, q, value) => {
    if (value.startsWith("[REDACTED")) return m;
    count++;
    return `${name}${sep}${q}[REDACTED:assignment]${q}`;
  });
  return { text, count };
}

/** Rekurencyjna redakcja wszystkich stringów w obiekcie. Zwraca { value, count }. */
export function redactDeep(value) {
  let count = 0;
  const walk = (v) => {
    if (typeof v === "string") {
      const r = redactString(v);
      count += r.count;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return { value: walk(value), count };
}

// ───────────────────────── Walidator JSON Schema (podzbiór) ─────────────────────────

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const typeMatches = (v, t) => {
  const actual = typeOf(v);
  return actual === t || (t === "number" && actual === "integer");
};

/**
 * Walidacja podzbioru JSON Schema 2020-12: type, enum, const, pattern, minLength, maxLength,
 * minimum, required, properties, additionalProperties, items, minItems, maxItems, format: date-time.
 * Zwraca listę błędów (pusta = poprawny).
 */
export function validateSchema(value, schema, at = "$") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push(`${at}: oczekiwano typu ${types.join("|")}, jest ${typeOf(value)}`);
      return errors;
    }
  }
  if ("const" in schema && value !== schema.const) errors.push(`${at}: oczekiwano ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: wartość spoza ${JSON.stringify(schema.enum)}`);
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at}: za krótkie (min ${schema.minLength})`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${at}: za długie (max ${schema.maxLength})`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: niezgodne z wzorcem ${schema.pattern}`);
    if (schema.format === "date-time" && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value)))) {
      errors.push(`${at}: niepoprawna data ISO 8601`);
    }
  }
  if (typeof value === "number" && schema.minimum != null && value < schema.minimum) errors.push(`${at}: mniejsze niż ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at}: za mało elementów (min ${schema.minItems})`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${at}: za dużo elementów (max ${schema.maxItems})`);
    if (schema.items) value.forEach((item, i) => errors.push(...validateSchema(item, schema.items, `${at}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${at}: brak wymaganego pola "${key}"`);
    const props = schema.properties || {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) errors.push(...validateSchema(v, props[key], `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: niedozwolone pole "${key}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validateSchema(v, schema.additionalProperties, `${at}.${key}`));
      }
    }
  }
  return errors;
}

// ───────────────────────────── Git i system plików ─────────────────────────────

export function git(root, args, { allowFail = true } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** Zapis atomowy: plik tymczasowy w tym samym katalogu + rename (czytelnik nigdy nie widzi połowy pliku). */
export function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Ścieżki wyłączone z odcisku stanu drzewa (generowane artefakty pamięci zmieniają się po każdym pomiarze). */
const FINGERPRINT_EXCLUDE = [`:(exclude)${MEMORY_DIR}`];

/**
 * Odcisk aktualnego stanu KODU: drzewo HEAD (bez project-memory/) + diff względem HEAD + zawartość plików
 * nieśledzonych. Liczony z treści, nie z hasha commita — commit zawierający wyłącznie artefakty pamięci
 * nie unieważnia raportów, ale każda zmiana kodu (zatwierdzona lub nie) zmienia odcisk → raport STALE.
 */
export function worktreeFingerprint(root) {
  const tree = (git(root, ["ls-tree", "-r", "--full-tree", "HEAD"]) ?? "NO_HEAD")
    .split("\n")
    .filter((l) => !l.split("\t")[1]?.startsWith(`${MEMORY_DIR}/`))
    .join("\n");
  const diff = git(root, ["diff", "HEAD", "--binary", "--no-color", "--", ".", ...FINGERPRINT_EXCLUDE]) ?? "";
  const untracked = (git(root, ["ls-files", "-o", "--exclude-standard", "--", ".", ...FINGERPRINT_EXCLUDE]) || "")
    .split("\n")
    .filter(Boolean)
    .sort();
  const h = crypto.createHash("sha256").update(tree).update("\0").update(diff);
  for (const f of untracked) {
    h.update("\0").update(f).update("\0");
    try {
      const st = fs.statSync(path.join(root, f));
      h.update(st.size > 5 * 1024 * 1024 ? `size:${st.size}:${st.mtimeMs}` : fs.readFileSync(path.join(root, f)));
    } catch {
      h.update("unreadable");
    }
  }
  return h.digest("hex");
}

export function gitSnapshot(root) {
  const commit = git(root, ["rev-parse", "HEAD"]);
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = git(root, ["status", "--porcelain=v1", "-uall"]);
  const changes = porcelain == null ? null : porcelain.split("\n").filter(Boolean);
  const codeChanges = changes == null ? null : changes.filter((l) => !l.slice(3).startsWith(`${MEMORY_DIR}/`));
  return {
    commit: commit || "UNKNOWN",
    shortCommit: commit ? commit.slice(0, 7) : "UNKNOWN",
    branch: branch || "UNKNOWN",
    dirty: codeChanges == null ? "UNKNOWN" : codeChanges.length > 0,
    changes: changes == null ? "UNKNOWN" : changes.slice(0, 200),
  };
}

/** Faktyczny sposób przechowywania/synchronizacji repozytorium (bez zakładania GitHuba). */
export function describeRemotes(root) {
  const raw = git(root, ["remote", "-v"]);
  if (raw == null) return { status: "UNKNOWN", remotes: [] };
  const map = new Map();
  for (const line of raw.split("\n").filter(Boolean)) {
    const [name, url] = line.split(/\s+/);
    const clean = redactString(url).text;
    let host = "local-path";
    const m = clean.match(/^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)/i) || clean.match(/^[^@\s]+@([^:]+):/);
    if (m) host = m[1];
    map.set(name, { name, url: clean, host, protocol: /^https?:/i.test(clean) ? "https" : /^ssh:|@[^:]+:/.test(clean) ? "ssh" : "file" });
  }
  const remotes = [...map.values()];
  const upstream = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  let aheadBehind = "UNKNOWN";
  if (upstream) {
    const counts = git(root, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`]);
    if (counts) {
      const [behind, ahead] = counts.split(/\s+/).map(Number);
      aheadBehind = { upstream, ahead, behind, note: "względem ostatniego lokalnego fetch" };
    }
  }
  return { status: remotes.length ? "OK" : "LOCAL_ONLY", remotes, upstream: upstream || "NONE", aheadBehind };
}

// ───────────────────────────── Raporty z rzeczywistych uruchomień ─────────────────────────────

export const DEFAULT_CHECKS = {
  "secret-scan": { file: "scripts/secret-scan.mjs", command: "node", args: ["scripts/secret-scan.mjs", "--all"] },
  lint: { npmScript: "lint", command: "npm", args: ["run", "lint"] },
  test: { npmScript: "test", command: "npm", args: ["test"] },
  build: { npmScript: "build", command: "npm", args: ["run", "build"] },
};

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");
const stripAnsi = (s) => s.replace(ANSI_RE, "");

/** Wyciągnij liczby z wyjścia narzędzia — tylko to, co faktycznie wypisało. */
export function summarizeOutput(check, output) {
  const text = stripAnsi(output || "");
  const pick = (re) => (text.match(re) || [])[0]?.trim() || null;
  if (check === "test") {
    return { testFiles: pick(/Test Files\s+[^\n]+/), tests: pick(/^\s*Tests\s+[^\n]+/m) };
  }
  if (check === "lint") {
    return { problems: pick(/✖\s*\d+ problems?[^\n]*/) || (text.trim() === "" ? null : pick(/\d+ problems?[^\n]*/)) };
  }
  if (check === "build") return { built: pick(/built in [^\n]+/) };
  if (check === "secret-scan") return { result: pick(/Skan sekretów[^\n]*/) };
  return {};
}

export function checkAvailability(root, def) {
  if (def.file) return fs.existsSync(path.join(root, def.file)) ? { available: true } : { available: false, reason: `brak pliku ${def.file}` };
  if (def.npmScript) {
    const pkg = readJson(path.join(root, "package.json"));
    return pkg?.scripts?.[def.npmScript] ? { available: true } : { available: false, reason: `brak skryptu npm "${def.npmScript}"` };
  }
  return { available: true };
}

/**
 * Uruchom polecenie NAPRAWDĘ i zapisz raport: data, commit, polecenie, kod wyjścia, ścieżka logu.
 * Log pełny (zredagowany) → project-memory/reports/logs/ (gitignored), raport → reports/<check>.json.
 */
export function runCheck(root, name, def = DEFAULT_CHECKS[name], { timeoutMs = 30 * 60 * 1000, now = () => new Date() } = {}) {
  if (!def) throw new Error(`Nieznany check: ${name}`);
  const avail = checkAvailability(root, def);
  const snap = gitSnapshot(root);
  const startedAt = now();
  const commandLine = [def.command, ...def.args].join(" ");
  let result = { status: null, signal: null, stdout: "", stderr: "", error: null };
  if (avail.available) {
    const r = spawnSync(def.command, def.args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: timeoutMs,
      env: { ...process.env, CI: process.env.CI || "1", FORCE_COLOR: "0" },
      shell: process.platform === "win32",
      windowsHide: true,
    });
    result = { status: r.status, signal: r.signal, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error ? String(r.error.message) : null };
  }
  const finishedAt = now();
  const output = redactString(stripAnsi(`${result.stdout}\n${result.stderr}`)).text;
  const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const logRel = `${MEMORY_DIR}/reports/logs/${name}-${stamp}.log`;
  if (avail.available) writeFileAtomic(path.join(root, logRel), output);
  const report = {
    schemaVersion: 1,
    check: name,
    command: commandLine,
    available: avail.available,
    unavailableReason: avail.reason || null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    commit: snap.commit,
    branch: snap.branch,
    worktreeDirty: snap.dirty,
    worktreeFingerprint: worktreeFingerprint(root),
    exitCode: avail.available ? result.status : null,
    signal: result.signal,
    timedOut: result.error ? /ETIMEDOUT/.test(result.error) : false,
    spawnError: result.error,
    summary: summarizeOutput(name, output),
    outputTail: output.split("\n").filter((l) => l.trim()).slice(-40),
    logPath: avail.available ? logRel : null,
  };
  const { value } = redactDeep(report);
  writeFileAtomic(P(root, "reports", `${name}.json`), JSON.stringify(value, null, 2) + "\n");
  return value;
}

/**
 * Oceń raport względem AKTUALNEGO stanu repo. PASS tylko gdy: kod wyjścia 0, identyczny kod (odcisk treści
 * bez project-memory/), raport nie starszy niż STALE_AFTER_MS. W przeciwnym razie FAIL/STALE/UNKNOWN.
 * Inny commit przy identycznym kodzie (np. commit samych artefaktów pamięci) jest jawnie opisany w reason.
 */
export function evaluateReport(report, { commit, fingerprint, now = new Date() }) {
  if (!report || typeof report !== "object") return { status: "UNKNOWN", reason: "brak raportu z rzeczywistego uruchomienia" };
  if (report.available === false) return { status: "UNKNOWN", reason: report.unavailableReason || "polecenie niedostępne" };
  if (typeof report.exitCode !== "number" && !report.timedOut) return { status: "UNKNOWN", reason: "raport bez kodu wyjścia" };
  const base = { command: report.command, exitCode: report.exitCode, finishedAt: report.finishedAt, commit: report.commit, logPath: report.logPath, summary: report.summary || {} };
  const sameCommit = report.commit === commit;
  if (report.worktreeFingerprint !== fingerprint) {
    return { ...base, status: "STALE", reason: sameCommit ? "kod zmienił się po uruchomieniu (inny odcisk drzewa)" : `raport z commita ${String(report.commit).slice(0, 7)}, HEAD to ${String(commit).slice(0, 7)} — kod się różni` };
  }
  const age = now - Date.parse(report.finishedAt);
  if (!(age >= 0) || age > STALE_AFTER_MS) return { ...base, status: "STALE", reason: "raport starszy niż 7 dni lub z przyszłości" };
  if (report.timedOut) return { ...base, status: "FAIL", reason: "przekroczono limit czasu" };
  const where = sameCommit ? "dla bieżącego stanu" : `— kod identyczny z commitem raportu ${String(report.commit).slice(0, 7)} (różnice tylko w ${MEMORY_DIR}/)`;
  return report.exitCode === 0 ? { ...base, status: "PASS", reason: `kod wyjścia 0 ${where}` } : { ...base, status: "FAIL", reason: `kod wyjścia ${report.exitCode} ${where}` };
}

export function reportDigest(report) {
  return sha256(JSON.stringify(report));
}

// ───────────────────────────── APK (rzeczywisty artefakt) ─────────────────────────────

/** Zapytaj GitHub (gh CLI) o ostatni build Androida i asset release. Brak gh/sieci → UNKNOWN. */
export function runApkCheck(root, { workflow = "android-v2.yml", now = () => new Date() } = {}) {
  const wf = fs.existsSync(path.join(root, ".github/workflows", workflow)) ? fs.readFileSync(path.join(root, ".github/workflows", workflow), "utf8") : "";
  const tag = (wf.match(/release_tag:[\s\S]*?default:\s*"([^"]+)"/) || [])[1] || null;
  const gh = (args) => {
    const r = spawnSync("gh", args, { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true });
    return r.status === 0 ? r.stdout : null;
  };
  const runRaw = gh(["run", "list", "--workflow", workflow, "-L", "1", "--json", "databaseId,headSha,conclusion,status,createdAt,event"]);
  const relRaw = tag ? gh(["release", "view", tag, "--json", "tagName,publishedAt,assets,url"]) : null;
  let run = null;
  let release = null;
  try { run = runRaw ? JSON.parse(runRaw)[0] || null : null; } catch { run = null; }
  try { release = relRaw ? JSON.parse(relRaw) : null; } catch { release = null; }
  const apkAssets = (release?.assets || []).filter((a) => /\.apk$/i.test(a.name)).map((a) => ({ name: a.name, size: a.size, url: a.url, digest: a.digest || null }));
  const report = {
    schemaVersion: 1,
    check: "apk",
    command: `gh run list --workflow ${workflow} -L 1 && gh release view ${tag ?? "?"}`,
    checkedAt: now().toISOString(),
    commit: git(root, ["rev-parse", "HEAD"]) || "UNKNOWN",
    workflow,
    releaseTag: tag,
    lastRun: run,
    releaseUrl: release?.url || null,
    releasePublishedAt: release?.publishedAt || null,
    apkAssets,
  };
  writeFileAtomic(P(root, "reports", "apk.json"), JSON.stringify(redactDeep(report).value, null, 2) + "\n");
  return report;
}

export function evaluateApk(report, { commit, now = new Date() }) {
  if (!report) return { status: "UNKNOWN", reason: "nie sprawdzono (uruchom sync z --apk)" };
  if (!report.lastRun || !report.releaseTag) return { status: "UNKNOWN", reason: "brak danych z GitHub (gh niedostępny lub brak uprawnień)" };
  const base = { releaseTag: report.releaseTag, releaseUrl: report.releaseUrl, assets: report.apkAssets, runId: report.lastRun.databaseId, runSha: report.lastRun.headSha, checkedAt: report.checkedAt };
  if (report.lastRun.conclusion !== "success") return { ...base, status: report.lastRun.status === "completed" ? "FAIL" : "UNKNOWN", reason: `ostatni build: ${report.lastRun.status}/${report.lastRun.conclusion || "-"}` };
  if (!report.apkAssets?.length) return { ...base, status: "UNKNOWN", reason: "build zielony, ale brak pliku .apk w release" };
  if (now - Date.parse(report.checkedAt) > STALE_AFTER_MS) return { ...base, status: "STALE", reason: "sprawdzenie starsze niż 7 dni" };
  if (report.lastRun.headSha !== commit) return { ...base, status: "STALE", reason: `APK zbudowany z ${String(report.lastRun.headSha).slice(0, 7)}, nie z HEAD` };
  return { ...base, status: "PASS", reason: "zielony build + asset .apk dla HEAD" };
}

// ───────────────────────────── Zdarzenia agentów ─────────────────────────────

export function loadEventSchema(root) {
  const s = readJson(P(root, "schema", "event.schema.json"));
  if (!s) throw new Error("Brak project-memory/schema/event.schema.json");
  return s;
}

/** Walidacja schematu + reguły semantyczne (PASS musi wynikać z raportu, nie z deklaracji). */
export function validateEvent(event, schema) {
  const errors = validateSchema(event, schema);
  if (errors.length) return errors;
  event.testResults.forEach((t, i) => {
    if (t.status === "PASS" && (t.exitCode !== 0 || !t.reportDigest || !t.reportCommit || t.source !== "report")) {
      errors.push(`$.testResults[${i}]: PASS bez dowodu (wymagane source=report, exitCode=0, reportCommit, reportDigest)`);
    }
  });
  return errors;
}

const safeSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "task";

/**
 * Zapisz zdarzenie jako NOWY plik: project-memory/events/<timestamp>-<agent>-<task>.json.
 * Tworzenie wyłączne (link → EEXIST) gwarantuje brak nadpisań przy równoległych agentach;
 * kolizja nazwy → sufiks -2, -3… Nigdy nie dopisuje do istniejącego pliku.
 */
export function writeEvent(root, input, { now = () => new Date() } = {}) {
  const schema = loadEventSchema(root);
  const { value: event, count } = redactDeep({ schemaVersion: 1, timestamp: now().toISOString(), ...input });
  event.redactions = (input.redactions || 0) + count;
  const errors = validateEvent(event, schema);
  if (errors.length) {
    const err = new Error(`Zdarzenie niezgodne ze schematem:\n- ${errors.join("\n- ")}`);
    err.validationErrors = errors;
    throw err;
  }
  const dir = P(root, "events");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = event.timestamp.replace(/[-:]/g, "").replace(/\.(\d{3})\d*Z$/, "$1Z");
  const base = `${stamp}-${safeSlug(event.agent)}-${safeSlug(event.taskId)}`;
  const tmp = path.join(dir, `.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`);
  fs.writeFileSync(tmp, JSON.stringify(event, null, 2) + "\n", { flag: "wx" });
  try {
    for (let n = 1; n < 1000; n++) {
      const file = path.join(dir, `${base}${n === 1 ? "" : `-${n}`}.json`);
      try {
        fs.linkSync(tmp, file);
        return { file, event };
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
    }
    throw new Error("Nie udało się nadać unikalnej nazwy zdarzenia");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function readEvents(root) {
  const dir = P(root, "events");
  if (!fs.existsSync(dir)) return [];
  let schema = null;
  try { schema = loadEventSchema(root); } catch { schema = null; }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .sort()
    .map((f) => {
      const rel = `${MEMORY_DIR}/events/${f}`;
      const event = readJson(path.join(dir, f));
      if (!event) return { file: rel, valid: false, errors: ["niepoprawny JSON"] };
      const errors = schema ? validateEvent(event, schema) : ["brak schematu"];
      return { file: rel, valid: errors.length === 0, errors, event };
    });
}

// ───────────────────────────── Istniejąca wiedza projektu ─────────────────────────────

export function loadSources(root) {
  return readJson(P(root, "sources.json")) || { documents: [], openItemSources: [], expectedButMissing: [] };
}

/** Wyciągnij otwarte sprawy z ISTNIEJĄCYCH dokumentów (z odniesieniem plik:linia) — bez drugiego backlogu. */
export function extractOpenItems(root, sources = loadSources(root)) {
  const items = [];
  const missing = [];
  for (const src of sources.openItemSources || []) {
    const file = path.join(root, src.file);
    if (!fs.existsSync(file)) {
      missing.push(src.file);
      continue;
    }
    const lines = fs.readFileSync(file, "utf8").split("\n");
    if (src.mode === "status-headings") {
      // ### X1. Tytuł   +   "Status: ..." w kolejnych liniach; otwarte = brak „wykonane".
      for (let i = 0; i < lines.length; i++) {
        const h = lines[i].match(/^###\s+(.+)$/);
        if (!h) continue;
        let status = null;
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
          if (/^#{1,3}\s/.test(lines[j])) break;
          const s = lines[j].match(/^Status:\s*(.+)$/i);
          if (s) { status = s[1].replace(/\*/g, "").trim(); break; }
        }
        const done = /wykonane|done|zrobione/i.test(status || "") || /[—-]\s*wykonane/i.test(h[1]);
        if (!done) items.push({ source: `${src.file}:${i + 1}`, kind: src.kind, text: h[1].trim(), status: status || "brak statusu w dokumencie" });
      }
    } else if (src.mode === "section-bullets") {
      const start = lines.findIndex((l) => new RegExp(src.heading).test(l));
      if (start < 0) continue;
      for (let i = start + 1; i < lines.length; i++) {
        if (/^#{1,3}\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) break;
        const b = lines[i].match(/^(?:-|\d+\.)\s+(.+)$/);
        if (b) items.push({ source: `${src.file}:${i + 1}`, kind: src.kind, text: b[1].replace(/\*\*/g, "").trim().slice(0, 220), status: "otwarte wg dokumentu" });
      }
    }
  }
  const expectedMissing = (sources.expectedButMissing || []).filter((f) => !fs.existsSync(path.join(root, f)));
  return { items, missingSources: missing, expectedMissing };
}

/** Narzędzia i możliwości z istniejącego manifestu (src/lib/selfManifest.ts + src/lib/tools.ts) — parsowanie źródła. */
export function readManifest(root) {
  const manifestFile = path.join(root, "src/lib/selfManifest.ts");
  const toolsFile = path.join(root, "src/lib/tools.ts");
  const out = { status: "UNKNOWN", version: "UNKNOWN", modules: [], tools: [] };
  if (fs.existsSync(manifestFile)) {
    const src = fs.readFileSync(manifestFile, "utf8");
    out.version = (src.match(/JARVIS_VERSION\s*=\s*"([^"]+)"/) || [])[1] || "UNKNOWN";
    const block = (src.match(/JARVIS_MODULES\s*=\s*\[([\s\S]*?)\]\s*as const/) || [])[1] || "";
    out.modules = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    out.status = out.modules.length ? "OK" : "UNKNOWN";
  }
  if (fs.existsSync(toolsFile)) {
    const src = fs.readFileSync(toolsFile, "utf8");
    out.tools = [...new Set([...src.matchAll(/^\s+name:\s*"([a-z][a-z0-9_]*)"/gm)].map((m) => m[1]))].sort();
  }
  out.source = "src/lib/selfManifest.ts (JARVIS_VERSION, JARVIS_MODULES) + src/lib/tools.ts (name:)";
  return out;
}

export function readWorkflows(root) {
  const dir = path.join(root, ".github/workflows");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      const name = (src.match(/^name:\s*(.+)$/m) || [])[1]?.trim() || f;
      const onBlock = (src.match(/^on:\s*\n((?:[ \t]+.*\n|\s*\n)+)/m) || [])[1] || "";
      const inline = (src.match(/^on:\s*\[?([^\n\]]+)\]?\s*$/m) || [])[1];
      const triggers = onBlock ? [...onBlock.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]) : inline ? inline.split(",").map((s) => s.trim()).filter(Boolean) : [];
      return { file: `.github/workflows/${f}`, name, triggers };
    });
}

export function readModules(root) {
  const files = (git(root, ["ls-files"]) || "").split("\n").filter(Boolean);
  const counts = {};
  for (const f of files) {
    const parts = f.split("/");
    const key = parts.length === 1 ? "(root)" : parts[0] === "src" && parts.length > 2 ? `src/${parts[1]}` : parts[0];
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([dir, files]) => ({ dir, files }))
    .sort((a, b) => b.files - a.files);
}

export function readDecisions(root) {
  const dir = P(root, "decisions");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^ADR-\d{4}.*\.md$/.test(f))
    .sort()
    .map((f) => {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      return {
        file: `${MEMORY_DIR}/decisions/${f}`,
        title: (src.match(/^#\s+(.+)$/m) || [])[1] || f,
        status: (src.match(/^(?:-\s*)?(?:\*\*)?Status:(?:\*\*)?\s*(.+)$/im) || [])[1]?.trim() || "UNKNOWN",
      };
    });
}

export function countFailedAttempts(root) {
  const f = P(root, "journal", "failed-attempts.md");
  if (!fs.existsSync(f)) return "UNKNOWN";
  return (fs.readFileSync(f, "utf8").match(/^##\s+FA-\d+/gm) || []).length;
}

// ───────────────────────────── Generator stanu ─────────────────────────────

/** Zbierz rzeczywisty stan projektu. Czysta funkcja względem dysku/gita (bez sieci). */
export function collectState(root, { now = new Date(), checks = Object.keys(DEFAULT_CHECKS) } = {}) {
  const snap = gitSnapshot(root);
  const fingerprint = worktreeFingerprint(root);
  const pkg = readJson(path.join(root, "package.json"));
  const checkResults = {};
  for (const name of checks) {
    const report = readJson(P(root, "reports", `${name}.json`));
    checkResults[name] = { ...evaluateReport(report, { commit: snap.commit, fingerprint, now }), reportPath: report ? `${MEMORY_DIR}/reports/${name}.json` : null };
  }
  const events = readEvents(root);
  const valid = events.filter((e) => e.valid).sort((a, b) => a.event.timestamp.localeCompare(b.event.timestamp));
  const open = extractOpenItems(root);
  const last = valid[valid.length - 1];
  const log = git(root, ["log", "-10", "--format=%h%x1f%cI%x1f%s"]);
  const state = {
    schemaVersion: 1,
    generatedBy: "scripts/sync-project-state.mjs",
    generatedAt: now.toISOString(),
    notice: "PLIK GENEROWANY — nie edytuj ręcznie. Odśwież: npm run memory:sync",
    git: { ...snap, worktreeFingerprint: fingerprint },
    repository: describeRemotes(root),
    project: { name: pkg?.name || "UNKNOWN", version: pkg?.version || "UNKNOWN" },
    modules: readModules(root),
    manifest: readManifest(root),
    scripts: pkg?.scripts ? Object.keys(pkg.scripts) : "UNKNOWN",
    workflows: readWorkflows(root),
    recentCommits: log ? log.split("\n").map((l) => { const [hash, date, subject] = l.split("\x1f"); return { hash, date, subject }; }) : "UNKNOWN",
    checks: checkResults,
    apk: evaluateApk(readJson(P(root, "reports", "apk.json")), { commit: snap.commit, now }),
    openItems: open.items,
    knowledgeGaps: { missingSources: open.missingSources, expectedButMissing: open.expectedMissing },
    events: {
      total: events.length,
      valid: valid.length,
      invalid: events.filter((e) => !e.valid).map((e) => ({ file: e.file, errors: e.errors.slice(0, 5) })),
      recent: valid.slice(-10).reverse().map((e) => ({ file: e.file, timestamp: e.event.timestamp, agent: e.event.agent, taskId: e.event.taskId, endCommit: e.event.endCommit, nextStep: e.event.nextStep })),
    },
    nextRecommendedStep: last ? { from: last.file, text: last.event.nextStep } : "UNKNOWN",
    decisions: readDecisions(root),
    failedAttempts: countFailedAttempts(root),
  };
  return state;
}

/** Część stanu niezależna od chwili generowania — do porównań (odtwarzanie po restarcie). */
export function stableView(state) {
  const { generatedAt: _g, integrity: _i, ...rest } = state;
  return rest;
}

export function withIntegrity(state) {
  const s = { ...state };
  delete s.integrity;
  return { ...s, integrity: sha256(JSON.stringify(s)) };
}

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Krótki raport (≤ MD_MAX_LINES linii). Pełne dane: CURRENT_STATE.json. */
export function renderMarkdown(state) {
  const L = [];
  const g = state.git;
  L.push("# JARVIS — CURRENT STATE (generowany)");
  L.push("");
  L.push(`> Wygenerowano ${state.generatedAt} przez \`${state.generatedBy}\`. **Nie edytuj ręcznie** — \`npm run memory:sync\`.`);
  L.push("> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.");
  L.push("");
  L.push("## Repozytorium");
  const remote = state.repository.remotes?.map((r) => `${r.name} → ${r.host} (${r.protocol})`).join(", ") || "brak (tylko lokalnie)";
  L.push(`- Commit \`${g.shortCommit}\` na \`${g.branch}\` · zmiany w drzewie (poza project-memory): ${g.dirty === true ? "TAK" : g.dirty === false ? "nie" : "UNKNOWN"}`);
  L.push(`- Zdalne: ${remote} · upstream: ${state.repository.upstream ?? "UNKNOWN"}`);
  L.push(`- Projekt: ${state.project.name}@${state.project.version} · manifest JARVIS ${state.manifest.version} (${state.manifest.modules.length} modułów, ${state.manifest.tools.length} narzędzi)`);
  L.push("");
  L.push("## Weryfikacja (rzeczywiste uruchomienia)");
  L.push("| Check | Status | Commit | Kod | Kiedy | Szczegóły |");
  L.push("|---|---|---|---|---|---|");
  for (const [name, c] of Object.entries(state.checks)) {
    const details = [c.reason, ...Object.values(c.summary || {}).filter(Boolean)].join(" · ");
    L.push(`| ${name} | **${c.status}** | ${c.commit ? String(c.commit).slice(0, 7) : "—"} | ${c.exitCode ?? "—"} | ${c.finishedAt || "—"} | ${cell(details)} |`);
  }
  const a = state.apk;
  L.push(`| apk | **${a.status}** | ${a.runSha ? a.runSha.slice(0, 7) : "—"} | — | ${a.checkedAt || "—"} | ${cell([a.reason, a.releaseTag, a.assets?.map((x) => x.name).join(", ")].filter(Boolean).join(" · "))} |`);
  L.push("");
  L.push("## Główne moduły (pliki śledzone)");
  L.push(state.modules.slice(0, 12).map((m) => `\`${m.dir}\` ${m.files}`).join(" · "));
  L.push("");
  L.push("## Workflowy CI");
  L.push(state.workflows.map((w) => `\`${path.basename(w.file)}\` (${w.triggers.join("/") || "?"})`).join(" · ") || "brak");
  L.push("");
  L.push("## Ostatnie commity");
  for (const c of (Array.isArray(state.recentCommits) ? state.recentCommits : []).slice(0, 5)) L.push(`- \`${c.hash}\` ${cell(c.subject).slice(0, 110)}`);
  L.push("");
  L.push(`## Otwarte sprawy z istniejącej dokumentacji (${state.openItems.length})`);
  for (const it of state.openItems.slice(0, 14)) L.push(`- ${cell(it.text).slice(0, 120)} — \`${it.source}\``);
  if (state.openItems.length > 14) L.push(`- … +${state.openItems.length - 14} w CURRENT_STATE.json`);
  L.push("");
  L.push(`## Dziennik agentów (${state.events.valid}/${state.events.total} poprawnych)`);
  for (const e of state.events.recent.slice(0, 5)) L.push(`- ${e.timestamp} · ${e.agent} · \`${e.taskId}\` → ${cell(e.nextStep).slice(0, 100)}`);
  if (state.nextRecommendedStep !== "UNKNOWN") L.push(`- **Następny krok (ostatnie zdarzenie):** ${cell(state.nextRecommendedStep.text).slice(0, 160)}`);
  L.push("");
  L.push(`## Decyzje: ${state.decisions.map((d) => `${path.basename(d.file, ".md")} (${d.status})`).join(", ") || "brak"} · nieudane podejścia: ${state.failedAttempts}`);
  const warn = [];
  if (state.events.invalid.length) warn.push(`${state.events.invalid.length} niepoprawnych zdarzeń: ${state.events.invalid.map((e) => path.basename(e.file)).slice(0, 3).join(", ")}`);
  if (state.knowledgeGaps.expectedButMissing.length) warn.push(`brakujące dokumenty referencyjne: ${state.knowledgeGaps.expectedButMissing.join(", ")}`);
  if (state.knowledgeGaps.missingSources.length) warn.push(`brak źródeł: ${state.knowledgeGaps.missingSources.join(", ")}`);
  if (warn.length) {
    L.push("");
    L.push("## Ostrzeżenia");
    for (const w of warn) L.push(`- ${w}`);
  }
  let lines = L;
  if (lines.length > MD_MAX_LINES - 1) lines = [...lines.slice(0, MD_MAX_LINES - 2), "- … (obcięto, pełne dane w CURRENT_STATE.json)"];
  const body = lines.join("\n") + "\n";
  return `<!-- GENERATED: scripts/sync-project-state.mjs · sha256:${sha256(body)} · DO NOT EDIT -->\n${body}`;
}

/** Wykryj ręczną edycję plików generowanych (niezgodny skrót). */
export function verifyGenerated(root) {
  const problems = [];
  const json = readJson(P(root, "CURRENT_STATE.json"));
  if (!json) problems.push("brak lub niepoprawny CURRENT_STATE.json");
  else if (withIntegrity(json).integrity !== json.integrity) problems.push("CURRENT_STATE.json edytowany ręcznie (niezgodny integrity)");
  const mdFile = P(root, "CURRENT_STATE.md");
  if (!fs.existsSync(mdFile)) problems.push("brak CURRENT_STATE.md");
  else {
    const md = fs.readFileSync(mdFile, "utf8");
    const m = md.match(/^<!-- GENERATED: [^\n]*sha256:([0-9a-f]{64}) [^\n]*-->\n/);
    if (!m || sha256(md.slice(m[0].length)) !== m[1]) problems.push("CURRENT_STATE.md edytowany ręcznie (niezgodny sha256)");
  }
  return problems;
}

// ───────────────────────────── Blokada zapisu stanu ─────────────────────────────

/**
 * Blokada lokalna (ten sam katalog roboczy). Dla odizolowanych wykonawców (osobne klony/kontenery)
 * NIE wystarcza — tam stan jest i tak regenerowalny: przy konflikcie nie scalaj, tylko uruchom sync ponownie.
 */
export function withLock(root, fn, { now = () => Date.now() } = {}) {
  const lock = P(root, ".lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: now() }), { flag: "wx" });
      try {
        return fn();
      } finally {
        fs.rmSync(lock, { force: true });
      }
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const info = readJson(lock);
      if (info && now() - info.at > LOCK_STALE_MS) {
        fs.rmSync(lock, { force: true });
        continue;
      }
      throw new Error(`project-memory jest zablokowane przez inny proces (pid ${info?.pid ?? "?"}). Spróbuj ponownie.`);
    }
  }
  throw new Error("Nie udało się uzyskać blokady project-memory");
}

/** Wygeneruj i zapisz CURRENT_STATE.json + CURRENT_STATE.md (atomowo, pod blokadą). */
export function syncState(root, opts = {}) {
  return withLock(root, () => {
    const state = withIntegrity(collectState(root, opts));
    writeFileAtomic(P(root, "CURRENT_STATE.json"), JSON.stringify(state, null, 2) + "\n");
    writeFileAtomic(P(root, "CURRENT_STATE.md"), renderMarkdown(state));
    return state;
  });
}
