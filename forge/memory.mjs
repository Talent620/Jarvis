/**
 * JARVIS FORGE — Verified Experience Memory (Pamięć, która naprawdę pomaga).
 *
 * Inspiracja: Reflexion + MemRL (Intent-Experience-Utility) + ReasoningBank, z twardą bramką dowodową:
 * - Nie składuje surowych rozmów ani niezweryfikowanych domysłów.
 * - Zapisuje 7 ustrukturyzowanych obszarów w `<repoRoot>/.jarvis-forge/memory.json`:
 *   1. `architecture`   — mapa kluczowych modułów, zależności, komend test/build/lint, reguł projektu.
 *   2. `decisions`      — kluczowe decyzje techniczne powiązane z zadaniem, plikami i testem (R3).
 *   3. `lessons`        — zweryfikowane rozwiązania `errorSignature -> fix` (dodawane WYŁĄCZNIE po FAIL->PASS) z `utilityScore`.
 *   4. `failedAttempts` — rejestr nieudanych podejść (anti-loop między iteracjami i zadaniami).
 *   5. `modelStats`     — realna skuteczność modeli per (provider, model, role): pass@1, średnie iteracje, latencja, 429.
 *   6. `strategyStats`  — skuteczność strategii naprawczych/wykonawczych.
 *   7. `taskHistory`    — zwięzła historia ukończonych/zablokowanych zadań z dowodami testów.
 * - Synergia z istniejącym `project-memory/` Jarvisa (czyta `CURRENT_STATE.json`, `decisions/ADR-*.md`
 *   oraz `journal/failed-attempts.md`, bez tworzenia konkurencyjnego systemu).
 */
import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, redactDeep, shortHash } from "./security.mjs";

const SCHEMA_VERSION = 1;
const MAX_LESSONS = 120;
const MAX_FAILED = 150;
const MAX_DECISIONS = 100;
const MAX_HISTORY = 80;

function emptyMemory(repoRoot) {
  return {
    schemaVersion: SCHEMA_VERSION,
    repoRoot: path.resolve(repoRoot),
    updatedAt: new Date().toISOString(),
    architecture: null,
    decisions: [],
    lessons: [],
    failedAttempts: [],
    modelStats: {},
    strategyStats: {},
    taskHistory: [],
  };
}

function tokenize(text) {
  return [...new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9_./-]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  )];
}

function overlapScore(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Set(tokensB);
  let hits = 0;
  for (const t of tokensA) if (setB.has(t)) hits += 1;
  return hits / Math.max(1, Math.min(tokensA.length, 10));
}

/** Odczytaj istniejący kontekst z `project-memory/` repozytorium (jeśli istnieje — np. w JARVIS). */
export function readJarvisProjectMemoryBridge(repoRoot) {
  const pmDir = path.join(repoRoot, "project-memory");
  if (!fs.existsSync(pmDir)) return null;
  const bridge = { adrs: [], failedAttempts: [], checks: null };

  try {
    const statePath = path.join(pmDir, "CURRENT_STATE.json");
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (state?.checks) {
        bridge.checks = Object.fromEntries(
          Object.entries(state.checks).map(([k, v]) => [k, v?.status || "UNKNOWN"]),
        );
      }
    }
  } catch { /* ignore */ }

  try {
    const decDir = path.join(pmDir, "decisions");
    if (fs.existsSync(decDir)) {
      for (const name of fs.readdirSync(decDir).filter((f) => f.endsWith(".md")).sort().slice(-8)) {
        const raw = fs.readFileSync(path.join(decDir, name), "utf8");
        const title = (raw.match(/^#\s+(.+)$/m) || [])[1] || name;
        const status = (raw.match(/\*\*Status:\*\*\s*([^\n]+)/i) || [])[1] || "unknown";
        bridge.adrs.push({ file: name, title: title.trim(), status: status.trim() });
      }
    }
  } catch { /* ignore */ }

  try {
    const faPath = path.join(pmDir, "journal", "failed-attempts.md");
    if (fs.existsSync(faPath)) {
      const raw = fs.readFileSync(faPath, "utf8");
      const matches = [...raw.matchAll(/^##\s+(FA-\d+\s+—\s+.+)$/gm)];
      bridge.failedAttempts = matches.slice(-10).map((m) => m[1].trim());
    }
  } catch { /* ignore */ }

  return bridge;
}

/** Otwórz lub zainicjalizuj pamięć doświadczeń dla danego repozytorium. */
export function createExperienceMemory(repoRoot, storageDir) {
  const root = path.resolve(repoRoot);
  const baseDir = path.resolve(storageDir || path.join(root, ".jarvis-forge"));
  const memPath = path.join(baseDir, "memory.json");

  const load = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(memPath, "utf8"));
      if (parsed && parsed.schemaVersion === SCHEMA_VERSION) return parsed;
    } catch { /* start fresh */ }
    return emptyMemory(root);
  };

  const data = load();

  const save = () => {
    data.updatedAt = new Date().toISOString();
    const clean = redactDeep(data).value;
    atomicWriteFile(memPath, JSON.stringify(clean, null, 2) + "\n");
  };

  /** Zaktualizuj zapamiętaną architekturę projektu ze skanu repo-intel. */
  function updateArchitecture(repoIndex) {
    data.architecture = {
      name: repoIndex.profile.name,
      languages: repoIndex.profile.languages,
      packageManager: repoIndex.profile.packageManager,
      totalFiles: repoIndex.totalFiles,
      edgeCount: repoIndex.edgeCount,
      coreModules: repoIndex.coreModules.slice(0, 12),
      testCommands: repoIndex.profile.testCommands.map((c) => c.label),
      lintCommands: repoIndex.profile.lintCommands.map((c) => c.label),
      typecheckCommands: repoIndex.profile.typecheckCommands.map((c) => c.label),
      buildCommands: repoIndex.profile.buildCommands.map((c) => c.label),
      projectRules: repoIndex.profile.projectRules,
      updatedAt: new Date().toISOString(),
    };
    save();
  }

  /** Zapisz zweryfikowaną lekcję Błąd -> Rozwiązanie (wyłącznie po realnym FAIL -> PASS!). */
  function recordVerifiedLesson({ errorSignature, errorSummary, rootCause, fixSummary, files = [], strategy = "direct_patch", runId }) {
    const sig = String(errorSignature || "").trim();
    if (!sig || !fixSummary) return null;
    const id = `L-${shortHash(`${sig}|${fixSummary}`, 8)}`;
    const existing = data.lessons.find((l) => l.errorSignature === sig);
    if (existing) {
      existing.fixSummary = String(fixSummary).slice(0, 500);
      existing.rootCause = String(rootCause || existing.rootCause || "").slice(0, 300);
      existing.files = [...new Set([...(existing.files || []), ...files])].slice(0, 10);
      existing.verifiedCount = (existing.verifiedCount || 1) + 1;
      existing.utilityScore = Math.min(1, Number(((existing.utilityScore || 0.7) + 0.1).toFixed(3)));
      existing.lastUsedAt = new Date().toISOString();
      save();
      return existing;
    }
    const lesson = {
      id,
      errorSignature: sig,
      errorSummary: String(errorSummary || "").slice(0, 360),
      rootCause: String(rootCause || "").slice(0, 300),
      fixSummary: String(fixSummary).slice(0, 500),
      files: [...new Set(files)].slice(0, 10),
      strategy,
      runId: runId || null,
      verifiedCount: 1,
      utilityScore: 0.8,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };
    data.lessons.unshift(lesson);
    if (data.lessons.length > MAX_LESSONS) {
      data.lessons.sort((a, b) => (b.utilityScore || 0) - (a.utilityScore || 0));
      data.lessons = data.lessons.slice(0, MAX_LESSONS);
    }
    save();
    return lesson;
  }

  /** Zapisz nieudaną próbę (twardy anti-loop). */
  function recordFailedAttempt({ goal, errorSignature, strategy, attemptSummary, files = [], provider, model, runId }) {
    const entry = {
      id: `F-${shortHash(`${errorSignature}|${strategy}|${attemptSummary}|${Date.now()}`, 8)}`,
      goal: String(goal || "").slice(0, 200),
      errorSignature: String(errorSignature || "unknown").slice(0, 200),
      strategy: String(strategy || "unknown"),
      attemptSummary: String(attemptSummary || "").slice(0, 360),
      files: [...new Set(files)].slice(0, 8),
      provider: provider || null,
      model: model || null,
      runId: runId || null,
      at: new Date().toISOString(),
    };
    data.failedAttempts.unshift(entry);
    if (data.failedAttempts.length > MAX_FAILED) data.failedAttempts = data.failedAttempts.slice(0, MAX_FAILED);
    save();
    return entry;
  }

  /** Zapisz istotną decyzję techniczną powiązaną z zadaniem i dowodem testów (R3). */
  function recordDecision({ title, rationale, files = [], runId, testEvidence }) {
    if (!title) return null;
    const dec = {
      id: `D-${shortHash(`${title}|${Date.now()}`, 8)}`,
      title: String(title).slice(0, 160),
      rationale: String(rationale || "").slice(0, 400),
      files: [...new Set(files)].slice(0, 12),
      runId: runId || null,
      testEvidence: String(testEvidence || "").slice(0, 200),
      at: new Date().toISOString(),
    };
    data.decisions.unshift(dec);
    if (data.decisions.length > MAX_DECISIONS) data.decisions = data.decisions.slice(0, MAX_DECISIONS);
    save();
    return dec;
  }

  /** Zapisz wynik wywołania modelu dla danej roli (uczenie routera). */
  function recordModelOutcome({ provider, model, role, ok, verifiedPass = null, latencyMs = 0, rateLimited = false, tokensIn = 0, tokensOut = 0 }) {
    const key = `${provider}::${model}::${role}`;
    const cur = data.modelStats[key] || {
      provider,
      model,
      role,
      calls: 0,
      successes: 0,
      failures: 0,
      rateLimits: 0,
      verifiedRuns: 0,
      verifiedPasses: 0,
      avgLatencyMs: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      lastUsedAt: null,
    };
    cur.calls += 1;
    if (ok) cur.successes += 1;
    else cur.failures += 1;
    if (rateLimited) cur.rateLimits += 1;
    if (verifiedPass !== null) {
      cur.verifiedRuns += 1;
      if (verifiedPass) cur.verifiedPasses += 1;
    }
    if (latencyMs > 0) {
      cur.avgLatencyMs = cur.avgLatencyMs
        ? Math.round(cur.avgLatencyMs * 0.7 + latencyMs * 0.3)
        : Math.round(latencyMs);
    }
    cur.totalTokensIn += Number(tokensIn || 0);
    cur.totalTokensOut += Number(tokensOut || 0);
    cur.lastUsedAt = new Date().toISOString();
    data.modelStats[key] = cur;
    save();
    return cur;
  }

  /** Zwróć wyuczoną skuteczność (0..1) modelu dla danej roli (null przy braku próbki). */
  function getModelScore(provider, model, role) {
    const stat = data.modelStats[`${provider}::${model}::${role}`];
    if (!stat || stat.calls < 2) return null;
    const callRate = (stat.successes + 1) / (stat.calls + 2);
    const verifyRate = stat.verifiedRuns > 0
      ? (stat.verifiedPasses + 0.5) / (stat.verifiedRuns + 1)
      : callRate;
    const rateLimitPenalty = Math.min(0.25, (stat.rateLimits / Math.max(1, stat.calls)) * 0.4);
    return Math.max(0, Math.min(1, Number((0.4 * callRate + 0.6 * verifyRate - rateLimitPenalty).toFixed(3))));
  }

  /** Zapisz skuteczność strategii wykonawczej/naprawczej. */
  function recordStrategyOutcome(strategy, succeeded, iterations = 1) {
    const cur = data.strategyStats[strategy] || { strategy, runs: 0, successes: 0, avgIterations: 0, lastUsedAt: null };
    cur.runs += 1;
    if (succeeded) cur.successes += 1;
    cur.avgIterations = cur.runs === 1
      ? iterations
      : Number(((cur.avgIterations * (cur.runs - 1) + iterations) / cur.runs).toFixed(2));
    cur.lastUsedAt = new Date().toISOString();
    data.strategyStats[strategy] = cur;
    save();
    return cur;
  }

  /** Zapisz zwięzły wpis historii wykonanego zadania. */
  function recordTaskHistory(entry) {
    data.taskHistory.unshift({
      runId: entry.runId,
      goal: String(entry.goal || "").slice(0, 220),
      status: entry.status,
      strategy: entry.strategy || "direct_patch",
      modifiedFiles: (entry.modifiedFiles || []).slice(0, 20),
      testsPassed: Boolean(entry.testsPassed),
      iterations: Number(entry.iterations || 0),
      providersUsed: [...new Set(entry.providersUsed || [])],
      summary: String(entry.summary || "").slice(0, 320),
      finishedAt: new Date().toISOString(),
    });
    if (data.taskHistory.length > MAX_HISTORY) data.taskHistory = data.taskHistory.slice(0, MAX_HISTORY);
    save();
  }

  /** Wyszukaj najbardziej trafne doświadczenia (lekcje + nieudane próby + decyzje + bridge project-memory). */
  function recallForContext({ goal = "", errorSignature = "", files = [], maxChars = 1800 } = {}) {
    const qTokens = tokenize(`${goal} ${errorSignature} ${files.join(" ")}`);
    const scoredLessons = data.lessons
      .map((l) => {
        let score = (l.utilityScore || 0.5) * 0.35;
        if (errorSignature && l.errorSignature === errorSignature) score += 2.0;
        score += overlapScore(qTokens, tokenize(`${l.errorSignature} ${l.errorSummary} ${l.rootCause} ${l.fixSummary} ${(l.files || []).join(" ")}`));
        return { item: l, score };
      })
      .filter((x) => x.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    const scoredFailures = data.failedAttempts
      .map((f) => {
        let score = 0;
        if (errorSignature && f.errorSignature === errorSignature) score += 2.0;
        score += overlapScore(qTokens, tokenize(`${f.goal} ${f.errorSignature} ${f.attemptSummary} ${(f.files || []).join(" ")}`));
        return { item: f, score };
      })
      .filter((x) => x.score >= 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    const scoredDecisions = data.decisions
      .map((d) => ({
        item: d,
        score: overlapScore(qTokens, tokenize(`${d.title} ${d.rationale} ${(d.files || []).join(" ")}`)),
      }))
      .filter((x) => x.score >= 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const bridge = readJarvisProjectMemoryBridge(root);
    const lines = [];
    if (scoredLessons.length) {
      lines.push("Zweryfikowane rozwiązania podobnych błędów:");
      for (const { item } of scoredLessons) {
        lines.push(`- [${item.id}] Błąd: ${item.errorSummary.slice(0, 120)} => Rozwiązanie: ${item.fixSummary}`);
      }
    }
    if (scoredFailures.length) {
      lines.push("Wcześniejsze nieudane podejścia (NIE powtarzaj bez zmiany strategii):");
      for (const { item } of scoredFailures) {
        lines.push(`- [${item.strategy}] ${item.attemptSummary.slice(0, 140)}`);
      }
    }
    if (scoredDecisions.length) {
      lines.push("Istotne decyzje techniczne w tym repo:");
      for (const { item } of scoredDecisions) {
        lines.push(`- ${item.title}: ${item.rationale.slice(0, 140)}`);
      }
    }
    if (bridge?.failedAttempts?.length) {
      lines.push(`Dziennik project-memory (failed-attempts): ${bridge.failedAttempts.slice(-3).join(" | ")}`);
    }

    const text = lines.join("\n").slice(0, maxChars);
    return {
      text,
      lessons: scoredLessons.map((x) => x.item),
      failedAttempts: scoredFailures.map((x) => x.item),
      decisions: scoredDecisions.map((x) => x.item),
      projectMemoryBridge: bridge,
    };
  }

  return {
    memPath,
    getSnapshot: () => ({ ...data, projectMemoryBridge: readJarvisProjectMemoryBridge(root) }),
    updateArchitecture,
    recordVerifiedLesson,
    recordFailedAttempt,
    recordDecision,
    recordModelOutcome,
    getModelScore,
    recordStrategyOutcome,
    recordTaskHistory,
    recallForContext,
  };
}
