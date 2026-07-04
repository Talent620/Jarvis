// === Trwałe cele autonomiczne (goalState) ===
// Cel JARVIS-a nie ginie po zamknięciu czatu. Plan, indeks kroku, wyniki (ActionOutcome) i
// correlationId żyją w IndexedDB, więc cel można prowadzić przez WIELE sesji: po restarcie
// proponujemy wznowienie, krok CONFIRMED nie wykonuje się drugi raz, a ATTEMPTED wymaga
// sprawdzenia (nie ślepego ponowienia — żeby nie wysłać maila dwa razy). Logika transformacji
// jest CZYSTA i w pełni testowalna; warstwa trwałości to cienki, wstrzykiwalny backend (domyślnie
// IndexedDB). S9-safe. Stare rekordy normalizujemy (kompatybilność wstecz).

import type { AgentPlan, PlanStep } from "./agentPlanner";
import type { ActionOutcome } from "./actionOutcome";
import { idbGet, idbSet } from "./db";

export type GoalStatus =
  | "queued"          // utworzony, jeszcze nie ruszył
  | "running"         // w trakcie wykonywania kroków
  | "waiting_consent" // czeka na zgodę (outbound / ryzykowny zapis)
  | "waiting_user"    // czeka na sprawdzenie/decyzję użytkownika (np. ATTEMPTED)
  | "paused"          // zatrzymany przez użytkownika
  | "completed"       // wszystkie kroki potwierdzone
  | "failed";         // trwały błąd / anulowany

export interface GoalRecord {
  id: string;
  goal: string;
  plan: AgentPlan;
  status: GoalStatus;
  /** Indeks następnego kroku do rozważenia (orientacyjny — prawda jest w results). */
  stepIndex: number;
  /** correlationId — klucz dedupu działań zewnętrznych (żeby nie powtórzyć wysyłki). */
  correlationId: string;
  /** Wyniki per krok (po id). CONFIRMED = wykonane i potwierdzone. */
  results: Record<string, ActionOutcome>;
  /** Id następnego bezpiecznego kroku (do wznowienia / panelu). */
  nextSafeStep?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export const GOALS_KEY = "cognitive.goals.v1";

/** Wstrzykiwalny backend trwałości (domyślnie IndexedDB) — w testach in-memory. */
export interface GoalStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<boolean>;
}
const idbStorage: GoalStorage = { get: (k) => idbGet(k), set: (k, v) => idbSet(k, v) };

const isConfirmed = (o?: ActionOutcome): boolean => o?.state === "CONFIRMED";
const isAttempted = (o?: ActionOutcome): boolean => o?.state === "ATTEMPTED";

/** Pure: nowy cel ze statusem queued. correlationId podajemy z zewnątrz (deterministycznie w testach). */
export function newGoal(goal: string, plan: AgentPlan, correlationId: string, now: number): GoalRecord {
  return { id: correlationId, goal, plan, status: "queued", stepIndex: 0, correlationId, results: {}, createdAt: now, updatedAt: now };
}

/** Pure: czy krok już potwierdzony (nie wykonuj go drugi raz)? */
export function isStepDone(rec: GoalRecord, stepId: string): boolean {
  return isConfirmed(rec.results[stepId]);
}

/** Pure: kroki ATTEMPTED — wymagają SPRAWDZENIA, nie ślepego ponowienia. */
export function attemptedSteps(rec: GoalRecord): string[] {
  return (rec.plan.steps || []).map((s) => s.id).filter((id) => isAttempted(rec.results[id]));
}

const depsConfirmed = (rec: GoalRecord, step: PlanStep): boolean =>
  (step.dependsOn || []).every((d) => isConfirmed(rec.results[d]));

/**
 * Pure: następny krok DO WYKONANIA. Pomija kroki CONFIRMED (nigdy 2x) i ATTEMPTED (czekają na
 * sprawdzenie), wymaga potwierdzonych zależności. null = nic bezpiecznego do zrobienia teraz.
 */
export function nextRunnableStep(rec: GoalRecord): PlanStep | null {
  for (const step of rec.plan.steps || []) {
    const o = rec.results[step.id];
    if (isConfirmed(o) || isAttempted(o)) continue;       // zrobione lub czeka na weryfikację
    if (o?.state === "FAILED") continue;                  // trwały błąd kroku — nie ponawiamy ślepo
    if (!depsConfirmed(rec, step)) continue;              // zależność jeszcze niepotwierdzona
    return step;
  }
  return null;
}

/** Pure: status całości z wyników kroków (deterministyczny). */
export function computeStatus(rec: GoalRecord): GoalStatus {
  if (rec.status === "paused" || rec.status === "failed") return rec.status;
  const steps = rec.plan.steps || [];
  if (steps.length && steps.every((s) => isConfirmed(rec.results[s.id]))) return "completed";
  if (steps.some((s) => isAttempted(rec.results[s.id]))) return "waiting_user";
  if (nextRunnableStep(rec)) return "running";
  // Nic do zrobienia, nic ATTEMPTED, nie wszystko CONFIRMED → coś blokuje (np. brak zgody).
  return steps.some((s) => rec.results[s.id]?.state === "DRAFT") ? "waiting_consent" : "queued";
}

/** Pure: zapisz wynik kroku, przelicz status, indeks i następny bezpieczny krok. Nigdy nie nadpisuje CONFIRMED. */
export function recordStepOutcome(rec: GoalRecord, stepId: string, outcome: ActionOutcome, now: number): GoalRecord {
  if (isConfirmed(rec.results[stepId])) return rec; // dedup: potwierdzonego kroku nie ruszamy
  const results = { ...rec.results, [stepId]: outcome };
  const next: GoalRecord = { ...rec, results, updatedAt: now };
  const runnable = nextRunnableStep(next);
  next.nextSafeStep = runnable?.id;
  const steps = next.plan.steps || [];
  const idx = runnable ? steps.findIndex((s) => s.id === runnable.id) : steps.length;
  next.stepIndex = idx < 0 ? next.stepIndex : idx;
  next.status = computeStatus(next);
  return next;
}

/** Pure: transformacje sterowane przez użytkownika. */
export function pauseGoal(rec: GoalRecord, now: number): GoalRecord { return { ...rec, status: "paused", updatedAt: now }; }
export function resumeGoal(rec: GoalRecord, now: number): GoalRecord {
  const resumed: GoalRecord = { ...rec, status: "running", updatedAt: now };
  resumed.status = computeStatus(resumed);
  return resumed;
}
export function cancelGoal(rec: GoalRecord, now: number): GoalRecord { return { ...rec, status: "failed", error: "anulowane przez użytkownika", updatedAt: now }; }

/** Pure: które cele warto wznowić po restarcie (nie zakończone i nie zarzucone)? */
export function resumableGoals(goals: GoalRecord[]): GoalRecord[] {
  return goals.filter((g) => g.status === "queued" || g.status === "running" || g.status === "waiting_consent" || g.status === "waiting_user" || g.status === "paused");
}

/** Pure: normalizacja starego/niepełnego rekordu (kompatybilność wstecz). */
export function normalizeGoal(raw: Partial<GoalRecord> & { id: string; goal: string; plan: AgentPlan }): GoalRecord {
  const now = raw.updatedAt || raw.createdAt || 0;
  return {
    id: raw.id,
    goal: raw.goal,
    plan: raw.plan,
    status: raw.status || "queued",
    stepIndex: typeof raw.stepIndex === "number" ? raw.stepIndex : 0,
    correlationId: raw.correlationId || raw.id,
    results: raw.results || {},
    nextSafeStep: raw.nextSafeStep,
    error: raw.error,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

// — Trwałość (IndexedDB, wstrzykiwalna) —

export async function loadGoals(storage: GoalStorage = idbStorage): Promise<GoalRecord[]> {
  const raw = await storage.get<GoalRecord[]>(GOALS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((r) => r && r.id && r.plan).map((r) => normalizeGoal(r));
}

export async function saveGoals(goals: GoalRecord[], storage: GoalStorage = idbStorage): Promise<boolean> {
  return storage.set(GOALS_KEY, goals);
}

/** Wstaw/zaktualizuj jeden cel (zachowuje pozostałe). */
export async function upsertGoal(rec: GoalRecord, storage: GoalStorage = idbStorage): Promise<GoalRecord[]> {
  const goals = await loadGoals(storage);
  const idx = goals.findIndex((g) => g.id === rec.id);
  if (idx >= 0) goals[idx] = rec; else goals.push(rec);
  await saveGoals(goals, storage);
  return goals;
}

export async function removeGoal(id: string, storage: GoalStorage = idbStorage): Promise<GoalRecord[]> {
  const goals = (await loadGoals(storage)).filter((g) => g.id !== id);
  await saveGoals(goals, storage);
  return goals;
}

/** Krótki, jawny opis celu do panelu (bez chain-of-thought). */
export function describeGoal(rec: GoalRecord): string {
  const steps = rec.plan.steps || [];
  const done = steps.filter((s) => isConfirmed(rec.results[s.id])).length;
  const label: Record<GoalStatus, string> = {
    queued: "w kolejce", running: "w toku", waiting_consent: "czeka na zgodę",
    waiting_user: "czeka na Twoje sprawdzenie", paused: "wstrzymany", completed: "ukończony", failed: "nieudany",
  };
  return `Cel: ${rec.goal} — ${label[rec.status]} (${done}/${steps.length} kroków potwierdzonych)`;
}
