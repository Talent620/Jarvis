// === Wspólny most głosowo-czatowy dla trwałych celów (voiceCognition + agentPlanner + goalRuntime) ===
// Spina wcześniej niepodpięte moduły poznawcze w głównej pętli czatu, głosowej (voiceLoop) i słuchawek:
// - parseVoiceGoalCommand / shortenForVoice / voiceCognition
// - validatePlan (agentPlanner) — każdy plan przechodzi twardą walidację narzędzi i zgód
// - startAndRunGoal / resumeAndRunGoal / loadGoalsNewestFirst (goalRuntime) — trwałość w IndexedDB
// S9-safe (ES2019, bez lookbehind i \p{...}).

import { parseVoiceGoalCommand, shortenForVoice, voiceCognition } from "./voiceCognition";
import { validatePlan, type AgentPlan } from "./agentPlanner";
import { loadGoalsNewestFirst, resumeAndRunGoal, startAndRunGoal } from "./goalRuntime";
import { getActiveGoalIds, requestGoalPause } from "./goalControl";
import type { GoalRecord, GoalStorage } from "./goalState";
import { recordSystemActionEvent, riskOf } from "./permissions";
import { toolDefs } from "./tools";
import { uid } from "./store";

export interface GoalBridgeResult {
  handled: boolean;
  ok?: boolean;
  text?: string;
  spokenText?: string;
  goalId?: string;
}

export interface GoalBridgeOptions {
  storage?: GoalStorage;
  now?: number;
  planBuilder?: (goalText: string) => AgentPlan;
  onStatus?: (status: string) => void;
}

const toolExists = (name: string): boolean => toolDefs.some((d) => d.name === name);

/** Pure: zbuduj deterministyczny, zwalidowany plan trwałego celu z opisu użytkownika. */
export function buildDefaultGoalPlan(goalText: string): AgentPlan {
  const clean = goalText.trim();
  const lower = clean.toLowerCase();
  const isShopping = /zakup|kup\b|sklep/.test(lower);
  const isNote = /notatk|zanotuj|zapisz informacje/.test(lower);

  if (isShopping) {
    return {
      goal: clean,
      confidence: 0.85,
      steps: [
        {
          id: "s1",
          intent: "Sprawdź aktualną listę zakupów",
          tool: "list_shopping",
          arguments: {},
          successCriteria: "Lista zakupów odczytana i potwierdzona",
        },
        {
          id: "s2",
          intent: `Dodaj pozycję celu do listy zakupów: ${clean}`,
          tool: "add_shopping_item",
          arguments: { name: clean },
          dependsOn: ["s1"],
          successCriteria: "Pozycja dodana do listy zakupów",
        },
      ],
    };
  }

  if (isNote) {
    return {
      goal: clean,
      confidence: 0.85,
      steps: [
        {
          id: "s1",
          intent: "Sprawdź istniejące notatki przed dopisaniem",
          tool: "list_notes",
          arguments: {},
          successCriteria: "Stan notatek potwierdzony",
        },
        {
          id: "s2",
          intent: `Zapisz notatkę roboczą dla celu: ${clean}`,
          tool: "add_note",
          arguments: { text: clean },
          dependsOn: ["s1"],
          successCriteria: "Notatka celu zapisana",
        },
      ],
    };
  }

  return {
    goal: clean,
    confidence: 0.85,
    steps: [
      {
        id: "s1",
        intent: "Sprawdź aktywną listę zadań przed rejestracją celu",
        tool: "list_tasks",
        arguments: {},
        successCriteria: "Lista aktywnych zadań potwierdzona",
      },
      {
        id: "s2",
        intent: `Zarejestruj cel jako śledzone zadanie: ${clean}`,
        tool: "add_task",
        arguments: { title: clean },
        dependsOn: ["s1"],
        successCriteria: "Zadanie celu utworzone w rejestrze zadań",
      },
    ],
  };
}

function summarizeGoalRecord(rec: GoalRecord): string {
  const total = rec.plan.steps.length;
  const confirmed = rec.plan.steps.filter((s) => rec.results[s.id]?.state === "CONFIRMED").length;
  const statusPl: Record<string, string> = {
    pending: "oczekuje",
    running: "w toku",
    paused: "wstrzymany",
    waiting_user: "czeka na sprawdzenie",
    waiting_consent: "czeka na zgodę",
    completed: "ukończony",
    failed: "nieudany",
  };
  return `Cel „${rec.goal}”: ${statusPl[rec.status] || rec.status} (${confirmed}/${total} kroków potwierdzonych).`;
}

function nextPendingStep(rec: GoalRecord): string {
  const pending = rec.plan.steps.find((s) => rec.results[s.id]?.state !== "CONFIRMED");
  if (!pending) return `Wszystkie kroki celu „${rec.goal}” są już potwierdzone.`;
  return `Następny krok celu „${rec.goal}”: ${pending.intent}${pending.tool ? ` (narzędzie: ${pending.tool})` : ""}.`;
}

const EXPLICIT_GOAL_WORD_RE = /\b(cel|celu|celem|plan|planu|planem)\b/i;

/**
 * Rozpoznaj i wykonaj głosową lub czatową komendę sterowania trwałym celem (voiceCognition → agentPlanner → goalRuntime).
 * Zwraca `{ handled: false }` dla zwykłej rozmowy lub niejednoznacznych zwrotów, gdy nie ma aktywnego celu.
 */
export async function handleVoiceOrChatGoalCommand(
  text: string,
  opts: GoalBridgeOptions = {},
): Promise<GoalBridgeResult> {
  const cmd = parseVoiceGoalCommand(text);
  if (!cmd) return { handled: false };

  const now = opts.now ?? Date.now();
  const explicitGoalMention = EXPLICIT_GOAL_WORD_RE.test(text);
  const cognition = voiceCognition(text);

  if (cmd.intent === "start_goal") {
    const goalText = (cmd.payload || "").trim();
    if (!goalText) {
      const msg = "Podaj treść celu, np. „rozpocznij cel: przygotuj ofertę dla klienta”.";
      return { handled: true, ok: false, text: msg, spokenText: shortenForVoice(msg) };
    }
    const plan = (opts.planBuilder || buildDefaultGoalPlan)(goalText);
    const validation = validatePlan(plan, { toolExists, riskOf });
    if (!validation.ok) {
      const errMsg = `Plan celu odrzucony przez walidator: ${validation.errors.join("; ")}`;
      recordSystemActionEvent({
        tool: "goal_runtime_start",
        risk: "write",
        input: { goal: goalText, mode: cognition.mode },
        output: errMsg,
        ok: false,
        security: true,
      });
      return { handled: true, ok: false, text: `⚠ ${errMsg}`, spokenText: shortenForVoice(errMsg) };
    }
    if (validation.question) {
      return { handled: true, ok: false, text: validation.question, spokenText: shortenForVoice(validation.question) };
    }

    const correlationId = `goal_${uid()}`;
    const { record, result } = await startAndRunGoal(
      { goal: goalText, plan, correlationId, now, onStatus: opts.onStatus },
      opts.storage,
    );
    const fullyConfirmed = result.verdict.canClaimSuccess;
    const ok = result.status !== "failed" && result.status !== "blocked";
    const prefix = fullyConfirmed ? "✅" : ok ? "📋" : "⚠";
    const msg = `${prefix} ${summarizeGoalRecord(record)} ${result.verdict.summary}`;
    recordSystemActionEvent({
      tool: "goal_runtime_start",
      risk: "write",
      input: { goal: goalText, steps: plan.steps.length, mode: cognition.mode },
      output: msg,
      ok,
    });
    return {
      handled: true,
      ok,
      goalId: record.id,
      text: msg,
      spokenText: shortenForVoice(msg),
    };
  }

  // Pozostałe intencje działają na zapisanych/aktywnych celach (bez przechwytywania zwykłej pogawędki, gdy celów brak).
  const goals = await loadGoalsNewestFirst(opts.storage).catch(() => [] as GoalRecord[]);
  const latest = goals.find((g) => g.status !== "completed") || goals[0] || null;
  if (!latest) {
    if (!explicitGoalMention) return { handled: false };
    const msg = "Nie masz jeszcze żadnego zapisanego celu. Powiedz np. „rozpocznij cel: ...”, aby utworzyć plan.";
    return { handled: true, ok: true, text: msg, spokenText: shortenForVoice(msg) };
  }

  if (cmd.intent === "ask_progress") {
    const msg = summarizeGoalRecord(latest);
    return { handled: true, ok: true, goalId: latest.id, text: msg, spokenText: shortenForVoice(msg) };
  }

  if (cmd.intent === "what_next") {
    const msg = nextPendingStep(latest);
    return { handled: true, ok: true, goalId: latest.id, text: msg, spokenText: shortenForVoice(msg) };
  }

  if (cmd.intent === "pause_plan") {
    const activeIds = getActiveGoalIds();
    const targets = activeIds.length ? activeIds : [latest.id];
    for (const id of targets) requestGoalPause(id);
    const msg = `⏸ Wstrzymałem plan celu „${latest.goal}”. Możesz go wznowić komendą „wznów cel”.`;
    recordSystemActionEvent({
      tool: "goal_runtime_pause",
      risk: "write",
      input: { goalId: latest.id },
      output: msg,
      ok: true,
    });
    return { handled: true, ok: true, goalId: latest.id, text: msg, spokenText: shortenForVoice(msg) };
  }

  if (cmd.intent === "resume_plan" || cmd.intent === "confirm_step") {
    if (latest.status === "completed") {
      if (!explicitGoalMention && cmd.intent === "confirm_step") return { handled: false };
      const msg = `Cel „${latest.goal}” jest już w pełni ukończony.`;
      return { handled: true, ok: true, goalId: latest.id, text: msg, spokenText: shortenForVoice(msg) };
    }
    const { record, result } = await resumeAndRunGoal(latest, { now, onStatus: opts.onStatus }, opts.storage);
    const ok = result.verdict.canClaimSuccess;
    const msg = `${ok ? "✅" : "⚠"} Wznowiono cel — ${summarizeGoalRecord(record)} ${result.verdict.summary}`;
    recordSystemActionEvent({
      tool: "goal_runtime_resume",
      risk: "write",
      input: { goalId: record.id },
      output: msg,
      ok,
    });
    return { handled: true, ok, goalId: record.id, text: msg, spokenText: shortenForVoice(msg) };
  }

  return { handled: false };
}

export { shortenForVoice };
