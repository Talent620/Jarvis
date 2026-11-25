/**
 * JARVIS FORGE — Autonomous Coding Engine (State Machine + Checkpoints + Condenser + Strategy Pivot).
 *
 * Realizuje pełny 13-krokowy cykl prawdziwej autonomii bez udawania sukcesu:
 *   SCOUTING -> PLANNING (architect) -> EXECUTING (developer) -> VERIFYING (0-token deterministic tests)
 *   -> [on error] DEBUGGING & STRATEGY_PIVOT (debugger + ExperienceMemory anti-loop + model escalation)
 *   -> REVIEWING (secret-scan + diff audit + cross-model reviewer) -> COMPLETED | PAUSED | BLOCKED | FAILED
 *
 * Każde zdarzenie i stan kroku są atomowo utrwalane w `<storageDir>/runs/<runId>.json`
 * oraz `<storageDir>/runs/<runId>.events.jsonl`, umożliwiając bezstratne wznawianie (`resumeRun`)
 * i deterministyczne cofnięcie wszystkich zmian (`rollbackRun`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, redactDeep, scanSecretsInText } from "./security.mjs";
import { buildRepoMap } from "./repo-intel.mjs";
import { createForgeWorkspace, extractErrorSignature, FORGE_TOOL_SCHEMAS } from "./workspace.mjs";
import { createExperienceMemory } from "./memory.mjs";

const STRATEGY_LADDER = [
  "direct_patch",
  "inspect_dependencies_and_replan",
  "isolate_minimal_fix",
  "escalate_different_provider",
];

function nowIso() {
  return new Date().toISOString();
}

function makeRunId() {
  const stamp = nowIso().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `forge-${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

/** Wyłuskaj obiekt JSON z odpowiedzi modelu (obsługuje bloki ```json ... ``` i czysty JSON). */
export function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Fallback dla lokalnych modeli, które zamiast natywnego `tool_calls` zwracają JSON w treści odpowiedzi. */
function extractInlineToolCall(text) {
  const obj = extractJsonObject(text);
  if (!obj || typeof obj !== "object") return null;
  const toolName = obj.tool || obj.name || obj.function;
  if (typeof toolName !== "string") return null;
  if (!FORGE_TOOL_SCHEMAS.some((t) => t.name === toolName)) return null;
  return {
    id: `inline_${Date.now()}`,
    name: toolName,
    arguments: (obj.arguments && typeof obj.arguments === "object") ? obj.arguments : (obj.args || obj.input || {}),
  };
}

/**
 * Context Condenser (wzorzec OpenHands / Claude Code):
 * Utrzymuje pamięć roboczą w limicie okna aktywnego modelu (np. ciasne 8K TPM na Groq / lokalna Ollama),
 * kondensując starsze obserwacje narzędzi do zwartego bloku bez utraty celu, planu, diffów i błędów.
 */
export function condenseWorkingMessages(messages, { maxChars = 24_000, goal = "", modifiedFiles = [], lastError = "" } = {}) {
  const totalLen = messages.reduce((sum, m) => sum + String(m.content || "").length + JSON.stringify(m.toolCalls || []).length, 0);
  if (totalLen <= maxChars || messages.length <= 6) return messages;

  const head = messages.slice(0, 1);
  const tail = messages.slice(-5);
  const middle = messages.slice(1, -5);
  const toolSummary = middle
    .filter((m) => m.role === "tool" || (m.role === "assistant" && m.toolCalls?.length))
    .slice(-12)
    .map((m) => {
      if (m.role === "assistant" && m.toolCalls?.length) {
        return `• Wywołano: ${m.toolCalls.map((t) => `${t.name}(${Object.keys(t.arguments || {}).join(",")})`).join(", ")}`;
      }
      return `• Wynik ${m.toolName || "tool"}: ${String(m.content || "").replace(/\s+/g, " ").slice(0, 180)}`;
    })
    .join("\n");

  const condensedNote = {
    role: "user",
    content: [
      `[SKONDENSOWANY STAN ROBOCZY — starsze ${middle.length} kroków zwinięto dla oszczędności kontekstu]`,
      `Cel: ${goal}`,
      `Zmodyfikowane pliki: ${modifiedFiles.length ? modifiedFiles.map((f) => `${f.path} (${f.action})`).join(", ") : "brak"}`,
      lastError ? `Ostatni błąd weryfikacji: ${lastError.slice(0, 350)}` : "",
      toolSummary ? `Skrót wcześniejszych działań:\n${toolSummary}` : "",
    ].filter(Boolean).join("\n"),
  };

  return [...head, condensedNote, ...tail];
}

function buildArchitectPrompt({ goal, repoMapText, profile, memoryText }) {
  return {
    system: [
      "Jesteś Architectem w systemie JARVIS FORGE — autonomicznym środowisku programistycznym.",
      "Twoim zadaniem jest dokładne zrozumienie celu i stworzenie krótkiego, konkretnego, weryfikowalnego planu technicznego.",
      "Odpowiedz WYŁĄCZNIE poprawnym obiektem JSON o schemacie:",
      '{ "summary": "krótki opis rozwiązania", "steps": [{ "id": "s1", "title": "konkretny krok", "role": "developer|verifier|reviewer" }], "targetFiles": ["ścieżki plików"], "verifyCommands": [{ "command": "npm", "args": ["test"] }], "risks": ["ewentualne ryzyko"], "decisionNote": "kluczowa decyzja techniczna" }',
      "Zasady: maksymalnie 6 kroków, używaj wyłącznie realnych ścieżek z Mapy Repozytorium, nigdy nie zakładaj sukcesu bez testów.",
    ].join("\n"),
    user: [
      `CEL ZADANIA: ${goal}`,
      "",
      repoMapText,
      "",
      `Wykryte komendy weryfikacyjne projektu: ${JSON.stringify([
        ...profile.testCommands,
        ...profile.typecheckCommands,
        ...profile.lintCommands,
      ])}`,
      memoryText ? `\nPAMIĘĆ DOŚWIADCZEŃ Z TEGO REPO:\n${memoryText}` : "",
    ].filter(Boolean).join("\n"),
  };
}

function buildDeveloperSystemPrompt({ strategy, projectRules }) {
  const strategyDirectives = {
    direct_patch: "Strategia: bezpośrednia, chirurgiczna zmiana przez read_file -> edit_file (SEARCH/REPLACE) -> uruchomienie testów -> finish_task.",
    inspect_dependencies_and_replan: "Strategia ZMIENIONA (pivot): NAJPIERW zbadaj zależności (repo_map / search_code) i przeczytaj powiązane pliki, dopiero potem popraw przyczynę źródłową.",
    isolate_minimal_fix: "Strategia ZMIENIONA (pivot): Zastosuj minimalną, izolowaną poprawkę skoncentrowaną wyłącznie na zgłaszanej asercji/błędzie, sprawdź każdy zmieniony wiersz.",
    escalate_different_provider: "Strategia ZMIENIONA (eskalacja modelu): Przeanalizuj problem świeżym okiem od podstaw, zweryfikuj założenia wcześniejszych prób i rozwiąż błąd czysto.",
  };

  return [
    "Jesteś Developerem/Debuggerem w autonomicznym środowisku JARVIS FORGE.",
    "Masz bezpośrednie narzędzia ACI do analizy, edycji i testowania prawdziwego repozytorium.",
    strategyDirectives[strategy] || strategyDirectives.direct_patch,
    "Zasady obowiązkowe:",
    "1. ZAWSZE przeczytaj plik przez read_file przed jego edycją.",
    "2. Preferuj chirurgiczne edit_file (SEARCH/REPLACE) zamiast nadpisywania całego pliku write_file.",
    "3. Nie osłabiaj ani nie usuwaj istniejących testów po to, by przeszły — napraw przyczynę w kodzie.",
    "4. Nigdy nie wpisuj kluczy API ani sekretów do plików.",
    "5. Gdy zmiany są gotowe i przetestowane, wywołaj finish_task z krótkim podsumowaniem.",
    ...(projectRules.length ? [`Reguły projektu: ${projectRules.join(" | ")}`] : []),
  ].join("\n");
}

function buildReviewerPrompt({ goal, diffsText, testSummary, secretFindings }) {
  return {
    system: [
      "Jesteś niezależnym Reviewerem kodu w JARVIS FORGE.",
      "Oceń rzetelnie, czy zmiany realizują cel, są bezpieczne, nie łamią kontraktów i są potwierdzone testami.",
      'Odpowiedz WYŁĄCZNIE poprawnym obiektem JSON: { "approved": true|false, "summary": "zwięzła ocena", "issues": ["konkretny problem jeśli istnieje"] }',
    ].join("\n"),
    user: [
      `CEL: ${goal}`,
      `SKAN SEKRETÓW: ${secretFindings.length ? `WYKRYTO: ${secretFindings.join(", ")}` : "CZYSTO"}`,
      `WYNIKI TESTÓW:\n${testSummary}`,
      `ZMIANY (DIFF):\n${diffsText.slice(0, 10_000)}`,
    ].join("\n\n"),
  };
}

/** Zapisz i odczytaj trwałe runy Forge z `<storageDir>/runs/`. */
export function createForgeStore(repoRoot, storageDir) {
  const root = path.resolve(repoRoot);
  const baseDir = path.resolve(storageDir || path.join(root, ".jarvis-forge"));
  const runsDir = path.join(baseDir, "runs");
  fs.mkdirSync(runsDir, { recursive: true });

  const runPath = (runId) => path.join(runsDir, `${runId}.json`);
  const eventsPath = (runId) => path.join(runsDir, `${runId}.events.jsonl`);

  function saveRun(state) {
    const clean = redactDeep(state).value;
    atomicWriteFile(runPath(state.id), JSON.stringify(clean, null, 2) + "\n");
  }

  function loadRun(runId) {
    try {
      return JSON.parse(fs.readFileSync(runPath(runId), "utf8"));
    } catch {
      return null;
    }
  }

  function appendEvent(runId, event) {
    const clean = redactDeep(event).value;
    fs.mkdirSync(runsDir, { recursive: true });
    fs.appendFileSync(eventsPath(runId), JSON.stringify(clean) + "\n", "utf8");
  }

  function readEvents(runId, limit = 200) {
    try {
      const lines = fs.readFileSync(eventsPath(runId), "utf8").split(/\r?\n/).filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  function listRuns(limit = 30) {
    try {
      const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, limit);
      return files.map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(runsDir, f), "utf8")); } catch { return null; }
      }).filter(Boolean).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    } catch {
      return [];
    }
  }

  return { baseDir, runsDir, saveRun, loadRun, appendEvent, readEvents, listRuns };
}

/**
 * Uruchom (lub wznów) autonomiczne zadanie inżynierskie JARVIS FORGE.
 */
export async function executeForgeRun({
  goal,
  repoRoot,
  storageDir,
  providerPool,
  costPolicy = "zero_cost",
  overrideKeys = {},
  maxIterations = 12,
  maxRepairCycles = 3,
  verifyCommands = null,
  resumeRunId = null,
  signal = null,
  shouldPause = null,
  onEvent = null,
}) {
  const root = path.resolve(repoRoot);
  const store = createForgeStore(root, storageDir);
  const memory = createExperienceMemory(root, store.baseDir);

  let state;
  if (resumeRunId) {
    const saved = store.loadRun(resumeRunId);
    if (!saved) throw new Error(`Nie znaleziono zapisanego zadania Forge o ID "${resumeRunId}".`);
    state = {
      ...saved,
      status: "executing",
      updatedAt: nowIso(),
      resumedCount: (saved.resumedCount || 0) + 1,
    };
  } else {
    const runId = makeRunId();
    state = {
      id: runId,
      goal: String(goal || "").trim(),
      repoRoot: root,
      costPolicy,
      status: "scouting",
      phase: "scouting",
      activeRole: "scout",
      activeExecutor: { provider: "local-cpu", model: "repo-intel", costTier: "local", reason: "Deterministyczny skan repozytorium (0 tokenów)" },
      progressPct: 5,
      iteration: 0,
      maxIterations,
      repairCycle: 0,
      maxRepairCycles,
      strategy: STRATEGY_LADDER[0],
      strategiesTried: [STRATEGY_LADDER[0]],
      plan: [],
      verifyCommands: Array.isArray(verifyCommands) ? verifyCommands : [],
      recentActions: [],
      testResults: [],
      modifiedFiles: [],
      problems: [],
      review: null,
      finalResult: null,
      providersUsed: [],
      resumedCount: 0,
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: null,
      _checkpoint: {
        errorCounts: {},
        lastErrorSignature: "",
        lastErrorSummary: "",
        lastErrorFiles: [],
        excludedProviders: [],
        lastDevProvider: null,
        hadFailureBeforePass: false,
        initialErrorInfo: null,
        decisionNote: "",
      },
    };
  }

  if (!state.goal) throw new Error("Cel zadania nie może być pusty.");

  const workspace = createForgeWorkspace({ repoRoot: root, runId: state.id, storageDir: store.baseDir });

  const emit = (type, payload = {}) => {
    const ev = { at: nowIso(), runId: state.id, type, phase: state.phase, role: state.activeRole, ...payload };
    state.updatedAt = ev.at;
    if (payload.actionLabel) {
      state.recentActions.unshift({
        at: ev.at,
        role: state.activeRole,
        type,
        text: String(payload.actionLabel).slice(0, 260),
        ok: payload.ok !== false,
      });
      if (state.recentActions.length > 60) state.recentActions = state.recentActions.slice(0, 60);
    }
    store.appendEvent(state.id, ev);
    store.saveRun(state);
    onEvent?.(ev, state);
  };

  const checkPauseOrAbort = () => {
    if (signal?.aborted) {
      state.status = "paused";
      state.phase = "paused";
      state.finalResult = "Zadanie zostało zatrzymane przez użytkownika. Możesz je wznowić od ostatniego checkpointu albo cofnąć zmiany.";
      emit("paused", { actionLabel: "Przerwano wykonanie (Kill-Switch / Abort)", ok: true });
      return true;
    }
    if (shouldPause?.()) {
      state.status = "paused";
      state.phase = "paused";
      state.finalResult = "Zadanie wstrzymane na żądanie użytkownika — pełny checkpoint zapisany na dysku.";
      emit("paused", { actionLabel: "Wstrzymano zadanie na bezpiecznym checkpoincie", ok: true });
      return true;
    }
    return false;
  };

  const syncModifiedFiles = () => {
    const fresh = workspace.getModifiedFiles();
    if (fresh.length) {
      const merged = new Map(state.modifiedFiles.map((f) => [f.path, f]));
      for (const f of fresh) merged.set(f.path, f);
      state.modifiedFiles = [...merged.values()];
    }
  };

  // --- ETAP 1: SCOUTING (0 tokenów LLM) ---
  state.status = "scouting";
  state.phase = "scouting";
  state.activeRole = "scout";
  state.progressPct = Math.max(state.progressPct, 10);
  emit("phase_change", { actionLabel: `Analiza repozytorium: ${path.basename(root)}` });

  const repoIndex = workspace.getIndex(true);
  memory.updateArchitecture(repoIndex);
  const repoMap = buildRepoMap(repoIndex, {
    query: state.goal,
    focusFiles: state._checkpoint.lastErrorFiles || [],
    maxChars: 5500,
  });
  const memContext = memory.recallForContext({
    goal: state.goal,
    errorSignature: state._checkpoint.lastErrorSignature,
    files: state._checkpoint.lastErrorFiles,
  });

  emit("scout_done", {
    actionLabel: `Zeskanowano ${repoIndex.totalFiles} plików (${repoIndex.edgeCount} zależności); pamięć: ${memContext.lessons.length} lekcji, ${memContext.failedAttempts.length} nieudanych prób`,
    totalFiles: repoIndex.totalFiles,
    languages: repoIndex.profile.languages,
  });

  if (checkPauseOrAbort()) return state;

  // --- ETAP 2: PLANNING (rola: architect) ---
  if (!state.plan.length) {
    state.status = "planning";
    state.phase = "planning";
    state.activeRole = "architect";
    state.progressPct = 20;
    emit("phase_change", { actionLabel: "Architect projektuje plan prac i strategię weryfikacji" });

    try {
      const prompt = buildArchitectPrompt({
        goal: state.goal,
        repoMapText: repoMap.text,
        profile: repoIndex.profile,
        memoryText: memContext.text,
      });
      const planReply = await providerPool.invokeForRole("architect", {
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        tools: [],
        costPolicy: state.costPolicy,
        overrideKeys,
        signal,
      });
      state.activeExecutor = {
        provider: planReply.provider,
        model: planReply.model,
        costTier: planReply.costTier,
        reason: "Rola Architect (planowanie i dekompozycja)",
      };
      if (!state.providersUsed.includes(`${planReply.provider}/${planReply.model}`)) {
        state.providersUsed.push(`${planReply.provider}/${planReply.model}`);
      }

      const parsed = extractJsonObject(planReply.content);
      if (parsed && Array.isArray(parsed.steps) && parsed.steps.length) {
        state.plan = parsed.steps.slice(0, 8).map((s, i) => ({
          id: String(s.id || `s${i + 1}`),
          title: String(s.title || s.intent || `Krok ${i + 1}`),
          role: String(s.role || "developer"),
          status: "pending",
          note: "",
        }));
        if (!state.verifyCommands.length && Array.isArray(parsed.verifyCommands) && parsed.verifyCommands.length) {
          state.verifyCommands = parsed.verifyCommands
            .filter((c) => c && typeof c.command === "string")
            .map((c) => ({ command: c.command, args: Array.isArray(c.args) ? c.args.map(String) : [], label: `${c.command} ${(c.args || []).join(" ")}`.trim() }));
        }
        if (parsed.decisionNote) state._checkpoint.decisionNote = String(parsed.decisionNote);
      } else {
        state.plan = [
          { id: "s1", title: "Zbadaj docelowe pliki i zależności", role: "developer", status: "pending", note: "" },
          { id: "s2", title: `Wdróż rozwiązanie celu: ${state.goal.slice(0, 80)}`, role: "developer", status: "pending", note: "" },
          { id: "s3", title: "Uruchom realne testy i zweryfikuj zmiany", role: "verifier", status: "pending", note: "" },
          { id: "s4", title: "Niezależna recenzja diffu i bezpieczeństwa", role: "reviewer", status: "pending", note: "" },
        ];
      }
      emit("plan_ready", {
        actionLabel: `Plan gotowy (${state.plan.length} kroków) · ${planReply.provider}/${planReply.model}`,
        plan: state.plan,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      state.status = "blocked";
      state.phase = "blocked";
      state.problems.push({ at: nowIso(), severity: "blocker", message: msg });
      state.finalResult = `Blokada na etapie planowania: ${msg}`;
      state.finishedAt = nowIso();
      memory.recordTaskHistory({
        runId: state.id,
        goal: state.goal,
        status: "blocked",
        strategy: state.strategy,
        modifiedFiles: [],
        testsPassed: false,
        iterations: state.iteration,
        providersUsed: state.providersUsed,
        summary: state.finalResult,
      });
      emit("blocked", { actionLabel: msg, ok: false });
      return state;
    }
  }

  // Uzupełnij domyślne komendy weryfikacyjne, jeśli Architect nie wskazał własnych
  if (!state.verifyCommands.length) {
    state.verifyCommands = [
      ...repoIndex.profile.testCommands,
      ...repoIndex.profile.typecheckCommands,
    ].slice(0, 3);
  }

  // --- PĘTLA GŁÓWNA: EXECUTING -> VERIFYING -> DEBUGGING / STRATEGY_PIVOT -> REVIEWING ---
  const workingMessages = [
    {
      role: "user",
      content: [
        `ZADANIE DO WYKONANIA: ${state.goal}`,
        `PLAN:\n${state.plan.map((s) => `- [${s.status}] ${s.id}: ${s.title}`).join("\n")}`,
        `MAPA REPOZYTORIUM:\n${repoMap.text}`,
        memContext.text ? `DOŚWIADCZENIA Z PAMIĘCI:\n${memContext.text}` : "",
        state._checkpoint.lastErrorSummary
          ? `KONTYNUACJA PO BŁĘDZIE (wznowienie):\n${state._checkpoint.lastErrorSummary}`
          : "",
      ].filter(Boolean).join("\n\n"),
    },
  ];

  const markPlanSteps = (roleFilter, status) => {
    for (const s of state.plan) {
      if (s.role === roleFilter && s.status !== "done") s.status = status;
    }
  };

  while (state.iteration < state.maxIterations) {
    if (checkPauseOrAbort()) return state;

    // 1. ETAP EXECUTING / DEBUGGING
    const isDebugPass = state.repairCycle > 0;
    state.status = isDebugPass ? "debugging" : "executing";
    state.phase = state.status;
    state.activeRole = isDebugPass ? "debugger" : "developer";
    markPlanSteps("developer", "active");
    state.progressPct = Math.min(82, 25 + Math.round((state.iteration / Math.max(1, state.maxIterations)) * 55));

    let devFinished = false;
    let stepBudgetForCycle = Math.min(6, state.maxIterations - state.iteration);

    while (stepBudgetForCycle > 0 && state.iteration < state.maxIterations) {
      if (checkPauseOrAbort()) return state;
      state.iteration += 1;
      stepBudgetForCycle -= 1;

      const roleToUse = isDebugPass ? "debugger" : "developer";
      const systemPrompt = buildDeveloperSystemPrompt({
        strategy: state.strategy,
        projectRules: repoIndex.profile.projectRules,
      });

      // Kondensacja kontekstu przed wywołaniem modelu
      const condensed = condenseWorkingMessages(workingMessages, {
        maxChars: 20_000,
        goal: state.goal,
        modifiedFiles: state.modifiedFiles,
        lastError: state._checkpoint.lastErrorSummary,
      });

      let reply;
      try {
        reply = await providerPool.invokeForRole(roleToUse, {
          system: systemPrompt,
          messages: condensed,
          tools: FORGE_TOOL_SCHEMAS,
          costPolicy: state.costPolicy,
          overrideKeys,
          excludeProviders: state._checkpoint.excludedProviders || [],
          signal,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Jeśli wykluczenie dostawcy po eskalacji wyczyściło pulę, spróbuj raz z pełną pulą
        if ((state._checkpoint.excludedProviders || []).length > 0) {
          state._checkpoint.excludedProviders = [];
          emit("strategy_note", { actionLabel: "Brak alternatywnego dostawcy po eskalacji — powrót do pełnej puli.", ok: true });
          continue;
        }
        state.status = "blocked";
        state.phase = "blocked";
        state.problems.push({ at: nowIso(), severity: "blocker", message: msg });
        state.finalResult = `Blokada wykonawcy (${roleToUse}): ${msg}`;
        state.finishedAt = nowIso();
        emit("blocked", { actionLabel: state.finalResult, ok: false });
        return state;
      }

      state.activeExecutor = {
        provider: reply.provider,
        model: reply.model,
        costTier: reply.costTier,
        reason: `Rola ${roleToUse} · strategia: ${state.strategy}`,
      };
      state._checkpoint.lastDevProvider = reply.provider;
      if (!state.providersUsed.includes(`${reply.provider}/${reply.model}`)) {
        state.providersUsed.push(`${reply.provider}/${reply.model}`);
      }

      let toolCalls = Array.isArray(reply.toolCalls) ? reply.toolCalls : [];
      if (!toolCalls.length && reply.content) {
        const inline = extractInlineToolCall(reply.content);
        if (inline) toolCalls = [inline];
      }

      workingMessages.push({
        role: "assistant",
        content: reply.content || "",
        ...(toolCalls.length ? { toolCalls } : {}),
      });

      if (!toolCalls.length) {
        // Model zakończył odpowiedź tekstowo — przejdź do obowiązkowej weryfikacji (nie ufamy słowom!)
        emit("model_note", { actionLabel: `${roleToUse} (${reply.provider}/${reply.model}): ${String(reply.content || "gotowe do weryfikacji").slice(0, 140)}` });
        devFinished = true;
        break;
      }

      for (const tc of toolCalls) {
        if (checkPauseOrAbort()) return state;
        const toolRes = await workspace.executeTool(tc.name, tc.arguments, { signal });
        syncModifiedFiles();

        const briefTarget = tc.arguments?.path || tc.arguments?.command || tc.arguments?.query || "";
        emit("tool_call", {
          tool: tc.name,
          ok: toolRes.ok !== false,
          actionLabel: `${tc.name}${briefTarget ? `(${String(briefTarget).slice(0, 60)})` : ""} → ${toolRes.ok !== false ? "OK" : `BŁĄD: ${String(toolRes.error || toolRes.errorSummary || "").slice(0, 100)}`}`,
        });

        workingMessages.push({
          role: "tool",
          toolCallId: tc.id,
          toolName: tc.name,
          content: JSON.stringify(toolRes).slice(0, 6500),
        });

        if (tc.name === "finish_task" && toolRes.finishedRequested) {
          if (Array.isArray(toolRes.verifyCommands) && toolRes.verifyCommands.length && !state.verifyCommands.length) {
            state.verifyCommands = toolRes.verifyCommands
              .filter((c) => c && typeof c.command === "string")
              .map((c) => ({ command: c.command, args: Array.isArray(c.args) ? c.args.map(String) : [], label: `${c.command} ${(c.args || []).join(" ")}`.trim() }));
          }
          devFinished = true;
          break;
        }
      }

      if (devFinished) break;
    }

    if (checkPauseOrAbort()) return state;

    // 2. ETAP VERIFYING (0 tokenów — twarda weryfikacja testami i skanem składni/sekretów!)
    state.status = "verifying";
    state.phase = "verifying";
    state.activeRole = "verifier";
    state.activeExecutor = { provider: "local-cpu", model: "deterministic-verifier", costTier: "local", reason: "Rzeczywiste uruchomienie testów i skan bezpieczeństwa (0 tokenów)" };
    state.progressPct = Math.max(state.progressPct, 84);
    markPlanSteps("verifier", "active");
    emit("phase_change", { actionLabel: `Weryfikacja rzeczywistymi komendami (${state.verifyCommands.length || 0})` });

    const cycleTests = [];
    let allPassed = true;
    let firstFailure = null;

    // 2a. Kontrola składni wszystkich zmodyfikowanych plików
    for (const mf of state.modifiedFiles) {
      if (mf.syntaxOk === false) {
        allPassed = false;
        firstFailure = {
          command: `syntax-check ${mf.path}`,
          errorSignature: `syntax:${mf.path}`,
          errorSummary: mf.syntaxError || "Błąd składni",
          errorFiles: [mf.path],
        };
        cycleTests.push({
          command: `syntax-check ${mf.path}`,
          ok: false,
          code: 1,
          durationMs: 0,
          output: mf.syntaxError || "Błąd składni",
          errorSignature: firstFailure.errorSignature,
          at: nowIso(),
        });
      }
    }

    // 2b. Uruchomienie realnych komend testowych / typecheck / lint
    if (allPassed) {
      for (const cmd of state.verifyCommands) {
        if (checkPauseOrAbort()) return state;
        const label = cmd.label || `${cmd.command} ${(cmd.args || []).join(" ")}`.trim();
        const res = await workspace.executeTool("run_command", {
          command: cmd.command,
          args: cmd.args || [],
          timeout_ms: 90_000,
        }, { signal });

        const record = {
          command: label,
          ok: Boolean(res.ok),
          code: res.code ?? (res.ok ? 0 : 1),
          durationMs: res.durationMs || 0,
          output: String(res.output || res.error || "").slice(0, 4000),
          errorSignature: res.errorSignature || null,
          at: nowIso(),
        };
        cycleTests.push(record);
        emit("verify_command", {
          command: label,
          ok: record.ok,
          code: record.code,
          actionLabel: `Test "${label}": ${record.ok ? "PASS (exit 0)" : `FAIL (exit ${record.code})`}`,
        });

        if (!record.ok) {
          allPassed = false;
          const sigInfo = res.errorSignature
            ? { signature: res.errorSignature, summary: res.errorSummary || record.output, files: res.errorFiles || [] }
            : extractErrorSignature(record.output, label);
          firstFailure = {
            command: label,
            errorSignature: sigInfo.signature,
            errorSummary: sigInfo.summary,
            errorFiles: sigInfo.files,
          };
          break;
        }
      }
    }

    state.testResults = [...cycleTests, ...state.testResults].slice(0, 30);

    // 3. ROZGAŁĘZIENIE: PORAŻKA -> DEBUGGING + STRATEGY PIVOT
    if (!allPassed && firstFailure) {
      state._checkpoint.hadFailureBeforePass = true;
      if (!state._checkpoint.initialErrorInfo) {
        state._checkpoint.initialErrorInfo = firstFailure;
      }
      state._checkpoint.lastErrorSignature = firstFailure.errorSignature;
      state._checkpoint.lastErrorSummary = firstFailure.errorSummary;
      state._checkpoint.lastErrorFiles = firstFailure.errorFiles;

      const prevCount = Number(state._checkpoint.errorCounts[firstFailure.errorSignature] || 0);
      const nextCount = prevCount + 1;
      state._checkpoint.errorCounts[firstFailure.errorSignature] = nextCount;

      memory.recordFailedAttempt({
        goal: state.goal,
        errorSignature: firstFailure.errorSignature,
        strategy: state.strategy,
        attemptSummary: `Komenda "${firstFailure.command}" zwróciła błąd: ${firstFailure.errorSummary.slice(0, 200)}`,
        files: state.modifiedFiles.map((f) => f.path),
        provider: state.activeExecutor?.provider,
        model: state.activeExecutor?.model,
        runId: state.id,
      });
      if (state._checkpoint.lastDevProvider) {
        memory.recordModelOutcome({
          provider: state._checkpoint.lastDevProvider,
          model: state.activeExecutor?.model || "unknown",
          role: isDebugPass ? "debugger" : "developer",
          ok: true,
          verifiedPass: false,
        });
      }

      state.repairCycle += 1;
      if (state.repairCycle > state.maxRepairCycles || state.iteration >= state.maxIterations) {
        state.status = "blocked";
        state.phase = "blocked";
        const reason = `Wyczerpano limit cykli samonaprawy (${state.maxRepairCycles}) — test "${firstFailure.command}" nadal nie przechodzi (${firstFailure.errorSignature}).`;
        state.problems.push({ at: nowIso(), severity: "blocker", message: reason, errorSignature: firstFailure.errorSignature });
        state.finalResult = `Zadanie zablokowane (uczciwa weryfikacja — nie udaję sukcesu): ${reason}`;
        state.finishedAt = nowIso();
        memory.recordStrategyOutcome(state.strategy, false, state.iteration);
        memory.recordTaskHistory({
          runId: state.id,
          goal: state.goal,
          status: "blocked",
          strategy: state.strategy,
          modifiedFiles: state.modifiedFiles.map((f) => f.path),
          testsPassed: false,
          iterations: state.iteration,
          providersUsed: state.providersUsed,
          summary: state.finalResult,
        });
        emit("blocked", { actionLabel: reason, ok: false });
        return state;
      }

      // STRATEGY PIVOT: jeśli ta sama sygnatura błędu wystąpiła >= 2x albo po każdym kolejnym cyklu naprawy
      let pivotedTo = null;
      if (nextCount >= 2 || state.repairCycle >= 2) {
        const nextIdx = Math.min(STRATEGY_LADDER.length - 1, state.strategiesTried.length);
        const nextStrat = STRATEGY_LADDER[nextIdx];
        if (nextStrat && nextStrat !== state.strategy) {
          state.strategy = nextStrat;
          if (!state.strategiesTried.includes(nextStrat)) state.strategiesTried.push(nextStrat);
          pivotedTo = nextStrat;
          if (nextStrat === "escalate_different_provider" && state._checkpoint.lastDevProvider) {
            state._checkpoint.excludedProviders = [...new Set([...(state._checkpoint.excludedProviders || []), state._checkpoint.lastDevProvider])];
          }
        }
      }

      const errorMemory = memory.recallForContext({
        goal: state.goal,
        errorSignature: firstFailure.errorSignature,
        files: firstFailure.errorFiles,
      });

      let extraMap = "";
      if (pivotedTo === "inspect_dependencies_and_replan" && firstFailure.errorFiles.length) {
        extraMap = `\nROZSZERZONA MAPA ZALEŻNOŚCI BŁĘDU:\n${buildRepoMap(workspace.getIndex(true), { query: firstFailure.errorSummary, focusFiles: firstFailure.errorFiles, maxChars: 3500 }).text}`;
      }

      state.problems.push({
        at: nowIso(),
        severity: "error",
        message: `Test "${firstFailure.command}" nie przeszedł (cykl naprawy ${state.repairCycle}/${state.maxRepairCycles}).`,
        errorSignature: firstFailure.errorSignature,
        strategyPivot: pivotedTo,
      });

      emit("debug_pivot", {
        ok: false,
        strategyPivot: pivotedTo,
        actionLabel: pivotedTo
          ? `Zmiana strategii -> ${pivotedTo} (błąd: ${firstFailure.errorSignature.slice(0, 70)})`
          : `Uruchamiam Debugger (cykl ${state.repairCycle}/${state.maxRepairCycles})`,
      });

      workingMessages.push({
        role: "user",
        content: [
          `WERYFIKACJA NIE PRZESZŁA (${firstFailure.command}).`,
          `Sygnatura błędu: ${firstFailure.errorSignature}`,
          `Szczegóły błędu:\n${firstFailure.errorSummary}`,
          pivotedTo ? `UWAGA: Poprzednia strategia zawiodła — wymuszono zmianę strategii na "${pivotedTo}". Zmień podejście!` : "",
          errorMemory.text ? `PODPOWIEDŹ Z PAMIĘCI DOŚWIADCZEŃ:\n${errorMemory.text}` : "",
          extraMap,
          "Zdiagnozuj przyczynę źródłową, popraw kod (nie osłabiaj testów!), a potem wywołaj finish_task.",
        ].filter(Boolean).join("\n\n"),
      });
      continue;
    }

    // 4. WSZYSTKIE TESTY ZIELONE -> ETAP REVIEWING (skan sekretów + niezależny Reviewer)
    markPlanSteps("developer", "done");
    markPlanSteps("verifier", "done");
    state.status = "reviewing";
    state.phase = "reviewing";
    state.activeRole = "reviewer";
    state.progressPct = 92;
    markPlanSteps("reviewer", "active");
    emit("phase_change", { actionLabel: "Niezależna recenzja zmian i skan bezpieczeństwa" });

    // 4a. Deterministyczny skan sekretów na wszystkich zmodyfikowanych plikach
    const secretFindings = [];
    for (const mf of state.modifiedFiles) {
      if (mf.action === "deleted") continue;
      const abs = path.join(root, mf.path);
      if (fs.existsSync(abs)) {
        const found = scanSecretsInText(fs.readFileSync(abs, "utf8"));
        for (const kind of found) secretFindings.push(`${mf.path}:${kind}`);
      }
    }

    let reviewApproved = secretFindings.length === 0;
    let reviewSummary = secretFindings.length
      ? `Wykryto potencjalne sekrety w plikach: ${secretFindings.join(", ")}`
      : "Deterministyczny skan sekretów czysty i wszystkie komendy weryfikacyjne zaliczone (exit 0).";
    let reviewIssues = secretFindings.length ? [reviewSummary] : [];
    let reviewerLabel = "deterministic-reviewer";

    // 4b. Niezależny model Reviewer (preferuje innego dostawcę niż Developer!)
    if (reviewApproved) {
      try {
        const diffsText = state.modifiedFiles.map((f) => f.diff || `[${f.action}] ${f.path}`).join("\n\n") || "(brak zmodyfikowanych plików)";
        const testSummary = cycleTests.map((t) => `- ${t.command}: ${t.ok ? "PASS" : "FAIL"} (exit ${t.code}, ${t.durationMs}ms)`).join("\n") || "Brak osobnych komend testowych — składnia zweryfikowana.";
        const revPrompt = buildReviewerPrompt({ goal: state.goal, diffsText, testSummary, secretFindings });
        const revReply = await providerPool.invokeForRole("reviewer", {
          system: revPrompt.system,
          messages: [{ role: "user", content: revPrompt.user }],
          tools: [],
          costPolicy: state.costPolicy,
          overrideKeys,
          preferDifferentFrom: state._checkpoint.lastDevProvider,
          signal,
        });
        reviewerLabel = `${revReply.provider}/${revReply.model}`;
        state.activeExecutor = {
          provider: revReply.provider,
          model: revReply.model,
          costTier: revReply.costTier,
          reason: revReply.provider !== state._checkpoint.lastDevProvider
            ? "Niezależny Reviewer (cross-model review)"
            : "Reviewer końcowy",
        };
        if (!state.providersUsed.includes(reviewerLabel)) state.providersUsed.push(reviewerLabel);

        const parsedRev = extractJsonObject(revReply.content);
        if (parsedRev && typeof parsedRev.approved === "boolean") {
          reviewApproved = parsedRev.approved;
          reviewSummary = String(parsedRev.summary || reviewSummary);
          reviewIssues = Array.isArray(parsedRev.issues) ? parsedRev.issues.map(String) : [];
        }
      } catch {
        // Jeśli brak drugiego modelu lub błąd recenzenta — nie blokujemy zweryfikowanych testami zmian, odnotowujemy uczciwie
        reviewerLabel = "deterministic-reviewer (fallback)";
      }
    }

    state.review = {
      approved: reviewApproved,
      reviewer: reviewerLabel,
      summary: reviewSummary,
      issues: reviewIssues,
      secretScanClean: secretFindings.length === 0,
    };

    if (!reviewApproved && state.repairCycle < state.maxRepairCycles && state.iteration < state.maxIterations) {
      state.repairCycle += 1;
      state.problems.push({ at: nowIso(), severity: "warn", message: `Reviewer zgłosił uwagi: ${reviewIssues.join("; ") || reviewSummary}` });
      emit("review_changes_requested", { ok: false, actionLabel: `Reviewer wymaga poprawy: ${reviewSummary.slice(0, 140)}` });
      workingMessages.push({
        role: "user",
        content: `NIEZALEŻNY REVIEWER ZGŁOSIŁ UWAGI:\n${reviewSummary}\nProblemy:\n- ${reviewIssues.join("\n- ")}\nPopraw te uwagi i wywołaj finish_task.`,
      });
      continue;
    }

    if (!reviewApproved) {
      state.status = "blocked";
      state.phase = "blocked";
      state.finalResult = `Zablokowano na etapie recenzji: ${reviewSummary}`;
      state.finishedAt = nowIso();
      emit("blocked", { ok: false, actionLabel: state.finalResult });
      return state;
    }

    // 5. SUKCES POTWIERDZONY DOWODAMI! Zapisz zweryfikowane doświadczenia w ExperienceMemory!
    markPlanSteps("reviewer", "done");
    for (const s of state.plan) if (s.status !== "done") s.status = "done";

    if (state._checkpoint.hadFailureBeforePass && state._checkpoint.initialErrorInfo) {
      memory.recordVerifiedLesson({
        errorSignature: state._checkpoint.initialErrorInfo.errorSignature,
        errorSummary: state._checkpoint.initialErrorInfo.errorSummary,
        rootCause: `Naprawiono w cyklu ${state.repairCycle} strategią "${state.strategy}"`,
        fixSummary: `${state.goal} — zmodyfikowano: ${state.modifiedFiles.map((f) => f.path).join(", ")}`,
        files: state.modifiedFiles.map((f) => f.path),
        strategy: state.strategy,
        runId: state.id,
      });
    }
    if (state._checkpoint.decisionNote) {
      memory.recordDecision({
        title: state.goal.slice(0, 120),
        rationale: state._checkpoint.decisionNote,
        files: state.modifiedFiles.map((f) => f.path),
        runId: state.id,
        testEvidence: cycleTests.map((t) => `${t.command}=0`).join(", ") || "syntax+review PASS",
      });
    }
    if (state._checkpoint.lastDevProvider) {
      memory.recordModelOutcome({
        provider: state._checkpoint.lastDevProvider,
        model: state.activeExecutor?.model || "unknown",
        role: "developer",
        ok: true,
        verifiedPass: true,
      });
    }
    memory.recordStrategyOutcome(state.strategy, true, state.iteration);

    state.status = "completed";
    state.phase = "completed";
    state.progressPct = 100;
    state.finishedAt = nowIso();
    state.finalResult = [
      `Zadanie ukończone i zweryfikowane testami (${cycleTests.length} komend PASS, recenzja: ${reviewerLabel}).`,
      state.modifiedFiles.length ? `Zmodyfikowane pliki (${state.modifiedFiles.length}): ${state.modifiedFiles.map((f) => f.path).join(", ")}.` : "Brak zmian w plikach.",
      `Strategia końcowa: ${state.strategy} · Iteracje: ${state.iteration}.`,
    ].join(" ");

    memory.recordTaskHistory({
      runId: state.id,
      goal: state.goal,
      status: "completed",
      strategy: state.strategy,
      modifiedFiles: state.modifiedFiles.map((f) => f.path),
      testsPassed: true,
      iterations: state.iteration,
      providersUsed: state.providersUsed,
      summary: state.finalResult,
    });

    emit("completed", { ok: true, actionLabel: state.finalResult });
    return state;
  }

  // Wyczerpanie limitu iteracji bez potwierdzenia testami — uczciwe BLOCKED
  state.status = "blocked";
  state.phase = "blocked";
  state.finalResult = `Osiągnięto limit iteracji (${state.maxIterations}) bez potwierdzenia wszystkimi testami. Możesz wznowić zadanie lub cofnąć zmiany.`;
  state.finishedAt = nowIso();
  memory.recordStrategyOutcome(state.strategy, false, state.iteration);
  memory.recordTaskHistory({
    runId: state.id,
    goal: state.goal,
    status: "blocked",
    strategy: state.strategy,
    modifiedFiles: state.modifiedFiles.map((f) => f.path),
    testsPassed: false,
    iterations: state.iteration,
    providersUsed: state.providersUsed,
    summary: state.finalResult,
  });
  emit("blocked", { ok: false, actionLabel: state.finalResult });
  return state;
}

/** Wycofaj zmiany z konkretnego runu na podstawie migawek w `.jarvis-forge/snapshots/<runId>/`. */
export function rollbackForgeRun({ repoRoot, runId, storageDir }) {
  const store = createForgeStore(repoRoot, storageDir);
  const workspace = createForgeWorkspace({ repoRoot, runId, storageDir: store.baseDir });
  const result = workspace.rollbackRun();
  const saved = store.loadRun(runId);
  if (saved) {
    saved.rolledBackAt = nowIso();
    saved.finalResult = `${saved.finalResult || ""} [Zmiany wycofane przez Rollback: ${result.restoredCount} plików]`.trim();
    store.saveRun(saved);
    store.appendEvent(runId, { at: saved.rolledBackAt, runId, type: "rollback", ok: true, restoredCount: result.restoredCount });
  }
  return result;
}
