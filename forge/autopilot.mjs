/**
 * JARVIS PHASE 4 — AUTOPILOT ORCHESTRATOR.
 *
 * Nadrzędny koordynator wykonawczy łączący w jeden spójny system wszystkie istniejące moduły Jarvisa:
 *   - Repo Intel (`forge/repo-intel.mjs`)
 *   - Project & Experience Memory (`forge/memory.mjs` + most `project-memory/`)
 *   - Adaptive Intelligence & Dynamic Agent Teams (`forge/adaptive.mjs` — JEDYNY router, brak duplikatu!)
 *   - Provider Registry (`forge/providers.mjs`)
 *   - Budget Governor (`forge/budget.mjs`)
 *   - Isolated Git Worktree (`forge/worktree.mjs`)
 *   - Forge Engine, Verifier, Cross-Model Reviewer, Checkpoints & Rollback (`forge/engine.mjs`)
 *
 * Zasady nienaruszalne:
 *   1. ZERO ręcznej konfiguracji dla użytkownika (jedno polecenie -> pełna autonomia).
 *   2. ZERO cichego uruchamiania płatnych modeli (`zero_cost` domyślnie, niezmienialność budżetu przez agenta).
 *   3. Jawna bramka zgody użytkownika (`waiting_approval`) dla akcji destrukcyjnych, zewnętrznych,
 *      deploy/publish/push oraz prób eskalacji budżetu.
 *   4. Każde zadanie ma limit czasu (`maxDurationMs`), limit iteracji, limit cykli naprawy,
 *      checkpoint, historię prób (`attemptHistory`) oraz deterministyczny rollback.
 */
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scanRepository } from "./repo-intel.mjs";
import { createExperienceMemory } from "./memory.mjs";
import { assessTaskDifficulty, composeAgentTeam } from "./adaptive.mjs";
import { COST_CATEGORIES } from "./budget.mjs";
import { isGitWorktreeCapable } from "./worktree.mjs";
import {
  createForgeStore,
  executeCompetitiveForgeRun,
  executeForgeRun,
  rollbackForgeRun,
} from "./engine.mjs";

const ALLOWED_POLICIES = new Set(["local_only", "zero_cost", "allow_promo_credits", "allow_credits", "allow_paid"]);

const DESTRUCTIVE_OR_EXTERNAL_RULES = [
  {
    kind: "production_deploy",
    label: "Wdrożenie / publikacja produkcyjna (deploy/publish/release)",
    re: /\b(?:deploy(?:\s+to)?\s+(?:prod|production|live|server)|wdroż(?:yć|enie)?\s+na\s+produkcj|npm\s+publish|docker\s+push|modal\s+deploy|vercel\s+--prod|netlify\s+deploy|publish\s+(?:package|release|to\s+npm|to\s+production)|opublikuj\s+(?:pakiet|wydanie|na\s+produkcj)|github\s+release\s+create)\b/i,
  },
  {
    kind: "git_remote_mutation",
    label: "Modyfikacja zdalnego repozytorium lub gałęzi main (push / force / merge main)",
    re: /\b(?:git\s+push|push\s+(?:to\s+)?(?:origin|main|master|remote)|force[- ]?push|wypchnij\s+na\s+(?:origin|main|github)|merge\s+(?:into|to)\s+main|scal\s+z\s+main|reset\s+--hard\s+origin)\b/i,
  },
  {
    kind: "destructive_data_op",
    label: "Operacja destrukcyjna na plikach lub bazie danych (rm -rf / DROP TABLE / wipe)",
    re: /\b(?:rm\s+-rf|drop\s+(?:table|database|schema)|truncate\s+table|usuń\s+całą\s+baz|wyczyść\s+bazę\s+produkcyjn|wipe\s+(?:database|production|disk)|format\s+disk)\b/i,
  },
];

const BUDGET_ESCALATION_RULES = [
  {
    kind: "budget_escalation",
    label: "Żądanie eskalacji budżetu lub płatnego modelu API",
    re: /\b(?:allow_paid|odblokuj\s+płatn|użyj\s+płatn(?:ego|ych)\s+(?:model|api|claude|openai)|use\s+paid\s+(?:api|model|claude|openai)|zwiększ\s+budżet|podnieś\s+limit\s+kosztów|raise\s+(?:the\s+)?budget|increase\s+(?:the\s+)?budget|bez\s+limitu\s+kosztów)\b/i,
  },
];

function nowIso() {
  return new Date().toISOString();
}

function makeAutopilotRunId() {
  const stamp = nowIso().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `autopilot-${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

function isGitTreeClean(repoRoot) {
  try {
    const out = execFileSync("git", ["status", "--porcelain=v1"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    const meaningful = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.endsWith(".jarvis-forge") && !l.includes(".jarvis-forge/"));
    return meaningful.length === 0;
  } catch {
    return false;
  }
}

/**
 * Deterministyczna bramka bezpieczeństwa misji przed uruchomieniem agenta.
 * Wykrywa żądania destrukcyjne, zewnętrzne (push/deploy/publish) oraz próby podniesienia budżetu.
 */
export function assessMissionSafety(goal = "") {
  const text = String(goal || "").trim();
  const triggers = [];

  for (const rule of BUDGET_ESCALATION_RULES) {
    const m = text.match(rule.re);
    if (m) triggers.push({ kind: rule.kind, label: rule.label, match: m[0] });
  }
  for (const rule of DESTRUCTIVE_OR_EXTERNAL_RULES) {
    const m = text.match(rule.re);
    if (m) triggers.push({ kind: rule.kind, label: rule.label, match: m[0] });
  }

  if (!triggers.length) {
    return {
      safeAuto: true,
      riskLevel: "low",
      decisionKind: null,
      triggers: [],
      decisionPrompt: null,
    };
  }

  const hasBudgetTrigger = triggers.some((t) => t.kind === "budget_escalation");
  const decisionKind = hasBudgetTrigger ? "budget_escalation" : "destructive_or_external";
  const summaryLabels = triggers.map((t) => t.label).join("; ");

  return {
    safeAuto: false,
    riskLevel: "high",
    decisionKind,
    triggers,
    decisionPrompt: hasBudgetTrigger
      ? `Zadanie zawiera żądanie zwiększenia budżetu lub użycia płatnego API (${summaryLabels}). Jarvis nie może samodzielnie podnieść budżetu ani przełączyć się na płatny model bez Twojej wyraźnej decyzji.`
      : `Zadanie wymaga potwierdzenia użytkownika przed wykonaniem — wykryto operację destrukcyjną lub zewnętrzną (${summaryLabels}).`,
  };
}

/**
 * Twarda ochrona polityki kosztów:
 * - Agent (`initiatedBy === "agent"`) NIE MOŻE podnieść polityki powyżej `zero_cost` ani zwiększać budżetu.
 * - Nawet dla użytkownika przejście na `allow_paid` wymaga jawnego `userApprovedPaid: true`.
 */
export function enforceBudgetPolicyGuard({
  requestedPolicy = "zero_cost",
  requestedPromoBudget = null,
  initiatedBy = "user",
  userApprovedPaid = false,
} = {}) {
  const normalized = ALLOWED_POLICIES.has(requestedPolicy) ? requestedPolicy : "zero_cost";

  if (initiatedBy === "agent") {
    if (normalized === "allow_paid" || normalized === "allow_promo_credits" || normalized === "allow_credits" || requestedPromoBudget) {
      const err = new Error(
        `Odmowa bezpieczeństwa: agent nie może samodzielnie podnieść polityki kosztów ("${normalized}") ani przydzielić budżetu. Wymagana jawna zgoda użytkownika.`,
      );
      err.code = "BUDGET_ESCALATION_DENIED";
      throw err;
    }
    return { costPolicy: normalized === "local_only" ? "local_only" : "zero_cost", promoBudget: null };
  }

  if (normalized === "allow_paid" && !userApprovedPaid) {
    const err = new Error(
      "Odmowa bezpieczeństwa: polityka allow_paid wymaga jawnego potwierdzenia użytkownika (userApprovedPaid: true). Domyślnie obowiązuje zero_cost ($0.00).",
    );
    err.code = "PAID_APPROVAL_REQUIRED";
    throw err;
  }

  return { costPolicy: normalized, promoBudget: requestedPromoBudget || null };
}

/** Dobór zerokonfiguracyjnych limitów i trybu pracy według sklasyfikowanej trudności z Adaptive Intelligence. */
export function resolveZeroConfigLimits(difficultyLevel = "simple", { isWorktreeReady = false, isCleanTree = false } = {}) {
  if (difficultyLevel === "hard") {
    return {
      leanSimple: false,
      maxIterations: 22,
      maxRepairCycles: 3,
      maxDurationMs: 540_000, // 9 min
      autoWorktree: Boolean(isWorktreeReady && isCleanTree),
    };
  }
  if (difficultyLevel === "medium") {
    return {
      leanSimple: false,
      maxIterations: 16,
      maxRepairCycles: 3,
      maxDurationMs: 360_000, // 6 min
      autoWorktree: Boolean(isWorktreeReady && isCleanTree),
    };
  }
  return {
    leanSimple: true,
    maxIterations: 10,
    maxRepairCycles: 2,
    maxDurationMs: 180_000, // 3 min
    autoWorktree: false,
  };
}

function buildAutopilotStages({ difficulty, teamComposition, verifyCommands, useWorktree }) {
  const stages = [
    { id: "stage-1", name: "Skan repozytorium i pamięci projektu", role: "scout", zeroTokens: true },
  ];
  if (!teamComposition.skipArchitect) {
    stages.push({ id: "stage-2", name: `Architektura i plan (${difficulty.level})`, role: "architect", zeroTokens: false });
  }
  stages.push({
    id: `stage-${stages.length + 1}`,
    name: useWorktree
      ? `Implementacja w izolowanym git worktree (${teamComposition.teamPattern})`
      : `Implementacja (${teamComposition.teamPattern})`,
    role: "developer",
    zeroTokens: false,
  });
  stages.push({
    id: `stage-${stages.length + 1}`,
    name: `Automatyczna weryfikacja (${verifyCommands.length || 1} komend testowych + analiza wpływu)`,
    role: "verifier",
    zeroTokens: true,
  });
  stages.push({
    id: `stage-${stages.length + 1}`,
    name: "Niezależna recenzja (cross-model + skan sekretów)",
    role: "reviewer",
    zeroTokens: false,
  });
  return stages;
}

/**
 * Zaplanuj misję Autopilota bez ręcznej konfiguracji:
 * analizuje cel, bezpieczeństwo, repozytorium, pamięć projektu, trudność, dostępnych dostawców
 * oraz dobiera optymalny zespół i twarde limity (czas, iteracje, koszt).
 */
export async function planAutopilotMission({
  goal,
  repoRoot,
  storageDir,
  providerPool,
  costPolicy = "zero_cost",
  promoBudget = null,
  overrideKeys = {},
  allowCompetitive = false,
  approvals = {},
  initiatedBy = "user",
  userApprovedPaid = false,
  maxDurationMs = null,
  maxIterations = null,
  maxRepairCycles = null,
  useWorktree = null,
  verifyCommands = null,
  probeLocal = true,
}) {
  const cleanGoal = String(goal || "").trim();
  if (!cleanGoal) throw new Error("Cel zadania Autopilota nie może być pusty.");

  const policyCheck = enforceBudgetPolicyGuard({
    requestedPolicy: costPolicy,
    requestedPromoBudget: promoBudget,
    initiatedBy,
    userApprovedPaid,
  });

  const root = path.resolve(repoRoot);
  const store = createForgeStore(root, storageDir);
  const memory = createExperienceMemory(root, store.baseDir);
  const repoIndex = scanRepository(root);
  const memRecall = memory.recallForContext({ goal: cleanGoal });
  const isWorktreeReady = isGitWorktreeCapable(root);
  const isCleanTree = isWorktreeReady ? isGitTreeClean(root) : false;

  const providerMatrix = typeof providerPool?.getProviderMatrix === "function"
    ? await providerPool.getProviderMatrix({
        costPolicy: policyCheck.costPolicy,
        overrideKeys,
        promoBudget: policyCheck.promoBudget,
        probeLocal,
        memoryOverride: memory,
      })
    : [];

  const readyProviders = providerMatrix.filter((p) => p.status === "ready" && p.allowedInPolicy !== false);
  const difficulty = assessTaskDifficulty({ goal: cleanGoal, repoIndex, memory });
  const teamComposition = composeAgentTeam({
    difficulty,
    repoIndex,
    providerMatrix,
    hardware: providerPool?.hardware || null,
    costPolicy: policyCheck.costPolicy,
    allowCompetitive: Boolean(allowCompetitive),
    hasPromoBudget: Boolean(policyCheck.promoBudget),
    isWorktreeReady,
  });

  const zeroCfg = resolveZeroConfigLimits(difficulty.level, { isWorktreeReady, isCleanTree });
  const effectiveUseWorktree = typeof useWorktree === "boolean"
    ? (useWorktree && isWorktreeReady)
    : zeroCfg.autoWorktree;
  const effectiveVerify = Array.isArray(verifyCommands) && verifyCommands.length
    ? verifyCommands
    : [...repoIndex.profile.testCommands, ...repoIndex.profile.typecheckCommands].slice(0, 3);
  const effectiveLimits = {
    maxIterations: Math.min(30, Math.max(2, Number(maxIterations) || zeroCfg.maxIterations)),
    maxRepairCycles: Math.min(6, Math.max(1, Number(maxRepairCycles) || zeroCfg.maxRepairCycles)),
    maxDurationMs: Math.max(0, Number(maxDurationMs ?? zeroCfg.maxDurationMs)),
    costPolicy: policyCheck.costPolicy,
    outOfPocketLimitUsd: policyCheck.costPolicy === "allow_paid" ? null : 0,
    budgetLocked: true,
  };

  const safety = assessMissionSafety(cleanGoal);
  const stages = buildAutopilotStages({
    difficulty,
    teamComposition,
    verifyCommands: effectiveVerify,
    useWorktree: effectiveUseWorktree,
  });

  let canExecute = true;
  let decisionRequired = false;
  let pendingDecision = null;
  let plannedStatus = "ready";

  // 1. Najpierw bramka bezpieczeństwa (akcje destrukcyjne / zewnętrzne / eskalacja budżetu)
  if (!safety.safeAuto) {
    const budgetApproved = safety.decisionKind === "budget_escalation" && Boolean(approvals.budgetApproved && userApprovedPaid);
    const destructiveApproved = safety.decisionKind === "destructive_or_external" && Boolean(approvals.destructiveApproved);
    if (!budgetApproved && !destructiveApproved) {
      canExecute = false;
      decisionRequired = true;
      plannedStatus = "waiting_approval";
      pendingDecision = {
        required: true,
        kind: safety.decisionKind,
        title: safety.decisionKind === "budget_escalation"
          ? "Wymagana decyzja użytkownika: zmiana polityki budżetu"
          : "Wymagana zgoda użytkownika: operacja podwyższonego ryzyka",
        reason: safety.decisionPrompt,
        triggers: safety.triggers,
        options: safety.decisionKind === "budget_escalation" ? ["reject"] : ["approve", "reject"],
      };
    }
  }

  // 2. Następnie sprawdzenie dostępności darmowych zasobów — NIGDY nie przeskakuj cicho na płatny model!
  if (canExecute && readyProviders.length === 0) {
    canExecute = false;
    decisionRequired = true;
    plannedStatus = "blocked";
    const blockedReasons = providerMatrix
      .slice(0, 5)
      .map((p) => `${p.id}: ${p.statusReason || p.status}`)
      .join(" | ");
    pendingDecision = {
      required: true,
      kind: "no_free_provider",
      title: "Brak dostępnego darmowego wykonawcy AI",
      reason: `W polityce "${policyCheck.costPolicy}" żaden darmowy model nie jest aktualnie gotowy (${blockedReasons || "brak dostawców"}). Jarvis NIE przełączył się automatycznie na płatny model. Uruchom lokalną Ollamę lub dodaj darmowy klucz API (np. Gemini / Cerebras / Groq / Mistral / OpenRouter :free).`,
      options: ["configure_free_provider", "start_local_ollama"],
    };
  }

  const readyLocalCount = readyProviders.filter((p) => p.costCategory === COST_CATEGORIES.LOCAL_FREE).length;
  const readyApiFreeCount = readyProviders.filter((p) => p.costCategory === COST_CATEGORIES.API_FREE).length;
  const readyPromoCount = readyProviders.filter((p) => p.costCategory === COST_CATEGORIES.PROMO_CREDITS).length;

  return {
    goal: cleanGoal,
    repoRoot: root,
    status: plannedStatus,
    canExecute,
    decisionRequired,
    pendingDecision,
    safety,
    difficulty,
    teamComposition,
    stages,
    limits: effectiveLimits,
    executionConfig: {
      leanSimple: zeroCfg.leanSimple,
      useWorktree: effectiveUseWorktree,
      isWorktreeReady,
      isCleanTree,
      useCompetitive: Boolean(teamComposition.useCompetitive && allowCompetitive && isWorktreeReady),
      verifyCommands: effectiveVerify,
    },
    resources: {
      hardwareTier: providerPool?.hardware?.tier || "unknown",
      readyCount: readyProviders.length,
      readyLocalCount,
      readyApiFreeCount,
      readyPromoCount,
      readyProviders: readyProviders.map((p) => ({
        id: p.id,
        label: p.label,
        costCategory: p.costCategory,
        defaultModel: p.defaultModel,
      })),
    },
    memoryContextSummary: {
      lessonsCount: memRecall.lessons.length,
      failedAttemptsCount: memRecall.failedAttempts.length,
      decisionsCount: memRecall.decisions.length,
      adrsCount: memRecall.adrs?.length || 0,
      projectChecksCount: memRecall.projectChecks?.length || 0,
    },
    plannedAt: nowIso(),
  };
}

function buildPausedOrBlockedAutopilotRun(missionPlan, { status, verdict, finalResult }) {
  const id = makeAutopilotRunId();
  const now = nowIso();
  return {
    id,
    goal: missionPlan.goal,
    repoRoot: missionPlan.repoRoot,
    worktreePath: null,
    costPolicy: missionPlan.limits.costPolicy,
    budgetLocked: true,
    status,
    verdict,
    phase: status,
    pauseReason: status === "waiting_approval" ? "approval_required" : "no_free_provider",
    pendingDecision: missionPlan.pendingDecision,
    activeRole: "autopilot",
    activeExecutor: {
      provider: "autopilot-orchestrator",
      model: "policy-gate",
      costTier: "local",
      reason: status === "waiting_approval"
        ? "Bramka bezpieczeństwa wymaga decyzji użytkownika"
        : "Brak dostępnego darmowego modelu w aktualnej polityce kosztów",
    },
    progressPct: status === "waiting_approval" ? 5 : 0,
    iteration: 0,
    maxIterations: missionPlan.limits.maxIterations,
    repairCycle: 0,
    maxRepairCycles: missionPlan.limits.maxRepairCycles,
    maxDurationMs: missionPlan.limits.maxDurationMs,
    strategy: "direct_patch",
    strategiesTried: [],
    attemptHistory: [],
    difficulty: missionPlan.difficulty,
    teamComposition: missionPlan.teamComposition,
    activeIntelligenceTier: missionPlan.teamComposition.initialTier,
    adaptiveTrace: [
      {
        at: now,
        event: status === "waiting_approval" ? "autopilot_waiting_approval" : "autopilot_blocked_preflight",
        difficulty: missionPlan.difficulty.level,
        score: missionPlan.difficulty.score,
        tier: missionPlan.teamComposition.initialTier,
        teamPattern: missionPlan.teamComposition.teamPattern,
        agentCount: missionPlan.teamComposition.agentCount,
        rationale: missionPlan.pendingDecision?.reason || finalResult,
      },
    ],
    usageTotals: { inputTokens: 0, outputTokens: 0 },
    autopilot: {
      zeroConfig: true,
      stages: missionPlan.stages,
      safety: missionPlan.safety,
      limits: missionPlan.limits,
      executionConfig: missionPlan.executionConfig,
      resources: missionPlan.resources,
      memoryContextSummary: missionPlan.memoryContextSummary,
      approvals: {},
    },
    plan: [],
    verifyCommands: missionPlan.executionConfig.verifyCommands,
    recentActions: [
      {
        at: now,
        role: "autopilot",
        type: status,
        text: finalResult.slice(0, 260),
        ok: false,
      },
    ],
    testResults: [],
    modifiedFiles: [],
    impactAnalysis: null,
    securityEvents: missionPlan.safety.triggers.map((t) => ({
      at: now,
      kind: t.kind,
      source: "autopilot_safety_gate",
      detail: `${t.label} (${t.match})`,
    })),
    budgetSnapshot: null,
    problems: [
      {
        at: now,
        severity: status === "waiting_approval" ? "warn" : "blocker",
        message: finalResult,
      },
    ],
    review: null,
    finalResult,
    providersUsed: [],
    resumedCount: 0,
    startedAt: now,
    updatedAt: now,
    finishedAt: status === "blocked" ? now : null,
    _checkpoint: {
      errorCounts: {},
      lastErrorSignature: "",
      lastErrorSummary: "",
      lastErrorFiles: [],
      excludedProviders: [],
      excludedModels: [],
      lastDevProvider: null,
      lastDevModel: null,
      hadFailureBeforePass: false,
      initialErrorInfo: null,
      decisionNote: "",
      workingSummary: [],
      tierIndex: 0,
      escalationLadder: missionPlan.teamComposition.escalationLadder,
    },
  };
}

/**
 * Uruchom kompletną misję Autopilota jednym poleceniem (zero ręcznej konfiguracji).
 * Zawsze zapisuje trwały rekord w Forge Store (również przy `waiting_approval` i `blocked`).
 */
export async function executeAutopilotMission({
  goal,
  repoRoot,
  storageDir,
  providerPool,
  costPolicy = "zero_cost",
  promoBudget = null,
  promoGovernor = null,
  overrideKeys = {},
  allowCompetitive = false,
  approvals = {},
  initiatedBy = "user",
  userApprovedPaid = false,
  maxDurationMs = null,
  maxIterations = null,
  maxRepairCycles = null,
  useWorktree = null,
  verifyCommands = null,
  probeLocal = true,
  signal = null,
  shouldPause = null,
  onEvent = null,
}) {
  const missionPlan = await planAutopilotMission({
    goal,
    repoRoot,
    storageDir,
    providerPool,
    costPolicy,
    promoBudget,
    overrideKeys,
    allowCompetitive,
    approvals,
    initiatedBy,
    userApprovedPaid,
    maxDurationMs,
    maxIterations,
    maxRepairCycles,
    useWorktree,
    verifyCommands,
    probeLocal,
  });

  const store = createForgeStore(missionPlan.repoRoot, storageDir);

  if (!missionPlan.canExecute) {
    const status = missionPlan.status === "waiting_approval" ? "waiting_approval" : "blocked";
    const verdict = status === "waiting_approval" ? "WAITING_APPROVAL" : "BLOCKED";
    const finalResult = missionPlan.pendingDecision?.reason || "Misja wymaga decyzji użytkownika przed wykonaniem.";
    const record = buildPausedOrBlockedAutopilotRun(missionPlan, { status, verdict, finalResult });
    store.saveRun(record);
    const ev = {
      at: record.updatedAt,
      runId: record.id,
      type: status,
      phase: status,
      role: "autopilot",
      ok: false,
      pendingDecision: record.pendingDecision,
      actionLabel: finalResult,
    };
    store.appendEvent(record.id, ev);
    onEvent?.(ev, record);
    return {
      ok: false,
      verdict,
      status,
      decisionRequired: true,
      missionPlan,
      run: record,
      competitive: null,
    };
  }

  const autopilotMeta = {
    zeroConfig: true,
    stages: missionPlan.stages,
    safety: missionPlan.safety,
    limits: missionPlan.limits,
    executionConfig: missionPlan.executionConfig,
    resources: missionPlan.resources,
    memoryContextSummary: missionPlan.memoryContextSummary,
    approvals,
  };

  if (missionPlan.executionConfig.useCompetitive) {
    const comp = await executeCompetitiveForgeRun({
      goal: missionPlan.goal,
      repoRoot: missionPlan.repoRoot,
      storageDir,
      providerPool,
      costPolicy: missionPlan.limits.costPolicy,
      promoBudget,
      promoGovernor,
      overrideKeys,
      maxIterations: missionPlan.limits.maxIterations,
      maxRepairCycles: missionPlan.limits.maxRepairCycles,
      maxDurationMs: missionPlan.limits.maxDurationMs,
      verifyCommands: missionPlan.executionConfig.verifyCommands,
      applyWinner: true,
      signal,
      onEvent,
    });
    const verdict = comp.ok ? "PASS" : "BLOCKED";
    return {
      ok: comp.ok,
      verdict,
      status: comp.status,
      decisionRequired: !comp.ok,
      missionPlan,
      run: null,
      competitive: comp,
    };
  }

  const run = await executeForgeRun({
    goal: missionPlan.goal,
    repoRoot: missionPlan.repoRoot,
    storageDir,
    providerPool,
    costPolicy: missionPlan.limits.costPolicy,
    promoBudget,
    promoGovernor,
    overrideKeys,
    maxIterations: missionPlan.limits.maxIterations,
    maxRepairCycles: missionPlan.limits.maxRepairCycles,
    maxDurationMs: missionPlan.limits.maxDurationMs,
    verifyCommands: missionPlan.executionConfig.verifyCommands,
    useWorktree: missionPlan.executionConfig.useWorktree,
    adaptive: true,
    leanSimple: missionPlan.executionConfig.leanSimple,
    autopilotMeta,
    signal,
    shouldPause,
    onEvent,
  });

  const verdict = run.verdict || (run.status === "completed" ? "PASS" : run.status === "paused" ? "PAUSED" : "BLOCKED");
  return {
    ok: run.status === "completed",
    verdict,
    status: run.status,
    decisionRequired: Boolean(run.pendingDecision?.required),
    missionPlan,
    run,
    competitive: null,
  };
}

/**
 * Obsługa jawnej decyzji użytkownika dla zadania w stanie `waiting_approval` (`approve` lub `reject`).
 * Agent NIGDY nie może sam zatwierdzić własnego zadania (`SELF_APPROVAL_DENIED`).
 */
export async function decideAutopilotMission({
  runId,
  repoRoot,
  storageDir,
  decision,
  providerPool,
  overrideKeys = {},
  initiatedBy = "user",
  userApprovedPaid = false,
  signal = null,
  shouldPause = null,
  onEvent = null,
}) {
  if (initiatedBy === "agent") {
    const err = new Error("Odmowa bezpieczeństwa: agent nie może samodzielnie zatwierdzić zadania wymagającego decyzji użytkownika.");
    err.code = "SELF_APPROVAL_DENIED";
    throw err;
  }

  const root = path.resolve(repoRoot);
  const store = createForgeStore(root, storageDir);
  const saved = store.loadRun(runId);
  if (!saved) {
    throw new Error(`Nie znaleziono misji Autopilota o ID "${runId}".`);
  }
  if (saved.status !== "waiting_approval") {
    throw new Error(`Misja "${runId}" nie oczekuje na decyzję użytkownika (aktualny status: ${saved.status}).`);
  }

  const action = String(decision || "").trim().toLowerCase();
  if (action !== "approve" && action !== "reject") {
    throw new Error('Decyzja musi mieć wartość "approve" lub "reject".');
  }

  if (action === "reject") {
    const now = nowIso();
    saved.status = "blocked";
    saved.verdict = "BLOCKED";
    saved.phase = "blocked";
    saved.pendingDecision = null;
    saved.finishedAt = now;
    saved.updatedAt = now;
    saved.finalResult = "Użytkownik odrzucił operację wymagającą potwierdzenia. Żadne zmiany w repozytorium nie zostały wykonane.";
    saved.recentActions = [
      { at: now, role: "autopilot", type: "approval_rejected", text: saved.finalResult, ok: false },
      ...(saved.recentActions || []),
    ].slice(0, 60);
    store.saveRun(saved);
    const ev = { at: now, runId, type: "blocked", phase: "blocked", role: "autopilot", ok: false, actionLabel: saved.finalResult };
    store.appendEvent(runId, ev);
    onEvent?.(ev, saved);
    return { ok: false, verdict: "BLOCKED", status: "blocked", run: saved };
  }

  // action === "approve"
  const kind = saved.pendingDecision?.kind || "destructive_or_external";
  if (kind === "budget_escalation" && !userApprovedPaid) {
    const err = new Error("Zatwierdzenie eskalacji płatnego budżetu wymaga jawnej flagi userApprovedPaid: true.");
    err.code = "PAID_APPROVAL_REQUIRED";
    throw err;
  }

  const now = nowIso();
  saved.autopilot = {
    ...(saved.autopilot || {}),
    approvals: {
      ...(saved.autopilot?.approvals || {}),
      destructiveApproved: kind === "destructive_or_external" ? true : Boolean(saved.autopilot?.approvals?.destructiveApproved),
      budgetApproved: kind === "budget_escalation" ? true : Boolean(saved.autopilot?.approvals?.budgetApproved),
      approvedAt: now,
    },
  };
  saved.status = "queued";
  saved.phase = "queued";
  saved.verdict = null;
  saved.pauseReason = null;
  saved.pendingDecision = null;
  saved.updatedAt = now;
  store.saveRun(saved);
  const ev = {
    at: now,
    runId,
    type: "approval_granted",
    phase: "queued",
    role: "autopilot",
    ok: true,
    actionLabel: `Użytkownik zatwierdził wykonanie misji (${kind}) — wznawiam wykonanie.`,
  };
  store.appendEvent(runId, ev);
  onEvent?.(ev, saved);

  const run = await executeForgeRun({
    repoRoot: root,
    storageDir,
    providerPool,
    resumeRunId: runId,
    costPolicy: saved.costPolicy || "zero_cost",
    overrideKeys,
    maxIterations: saved.maxIterations || 12,
    maxRepairCycles: saved.maxRepairCycles || 3,
    maxDurationMs: saved.maxDurationMs || 0,
    useWorktree: Boolean(saved.autopilot?.executionConfig?.useWorktree),
    leanSimple: Boolean(saved.autopilot?.executionConfig?.leanSimple),
    adaptive: true,
    autopilotMeta: saved.autopilot,
    signal,
    shouldPause,
    onEvent,
  });

  const verdict = run.verdict || (run.status === "completed" ? "PASS" : run.status === "paused" ? "PAUSED" : "BLOCKED");
  return { ok: run.status === "completed", verdict, status: run.status, run };
}

/** Wznów przerwane/wstrzymane zadanie Autopilota z ostatniego checkpointu bez zmiany polityki kosztów. */
export async function resumeAutopilotMission({
  runId,
  repoRoot,
  storageDir,
  providerPool,
  overrideKeys = {},
  maxDurationMs = null,
  maxIterations = null,
  signal = null,
  shouldPause = null,
  onEvent = null,
}) {
  const root = path.resolve(repoRoot);
  const store = createForgeStore(root, storageDir);
  const saved = store.loadRun(runId);
  if (!saved) throw new Error(`Nie znaleziono zadania do wznowienia: "${runId}".`);
  if (saved.status === "waiting_approval") {
    const err = new Error(`Zadanie "${runId}" oczekuje na jawną decyzję użytkownika (użyj decide approve/reject).`);
    err.code = "APPROVAL_REQUIRED";
    throw err;
  }

  const now = nowIso();
  saved.status = "queued";
  saved.phase = "queued";
  saved.verdict = null;
  saved.pauseReason = null;
  saved.pendingDecision = null;
  saved.updatedAt = now;
  store.saveRun(saved);
  const ev = {
    at: now,
    runId,
    type: "resumed",
    phase: "queued",
    role: "autopilot",
    ok: true,
    actionLabel: "Wznowiono zadanie z ostatniego checkpointu.",
  };
  store.appendEvent(runId, ev);
  onEvent?.(ev, saved);

  const run = await executeForgeRun({
    repoRoot: root,
    storageDir,
    providerPool,
    resumeRunId: runId,
    costPolicy: saved.costPolicy || "zero_cost",
    overrideKeys,
    maxIterations: maxIterations ? Math.max(Number(saved.maxIterations || 0), Number(maxIterations)) : (saved.maxIterations || 12),
    maxRepairCycles: saved.maxRepairCycles || 3,
    maxDurationMs: maxDurationMs !== null ? Number(maxDurationMs) : (saved.maxDurationMs || 0),
    adaptive: true,
    leanSimple: Boolean(saved.autopilot?.executionConfig?.leanSimple),
    autopilotMeta: saved.autopilot || null,
    signal,
    shouldPause,
    onEvent,
  });

  const verdict = run.verdict || (run.status === "completed" ? "PASS" : run.status === "paused" ? "PAUSED" : "BLOCKED");
  return { ok: run.status === "completed", verdict, status: run.status, run };
}

/** Deterministyczny rollback wszystkich zmian misji Autopilota. */
export function rollbackAutopilotMission({ runId, repoRoot, storageDir }) {
  return rollbackForgeRun({ repoRoot, runId, storageDir });
}
