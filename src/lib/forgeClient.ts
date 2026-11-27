// === Klient JARVIS FORGE (łącznik UI React <-> lokalny serwer Forge :3220) ===
// Zero konfiguracji dla użytkownika: automatycznie korzysta z lokalnego serwera
// (w Electronie uruchamia go przez IPC `ensureLocalForge`) oraz pobiera już wpisane
// klucze darmowych dostawców i adres Ollamy z `store.settings` (wyłącznie w RAM). S9-safe.

import { desktop } from "./desktop";
import { orderedKeys } from "./keys";
import { store } from "./store";

export const FORGE_DEFAULT_URL = "http://127.0.0.1:3220";

export type ForgeCostPolicy = "zero_cost" | "local_only" | "allow_promo_credits" | "allow_credits" | "allow_paid";

export interface ForgeHardwareProfile {
  platform: string;
  arch: string;
  cpuCores: number;
  totalRamGb: number;
  freeRamGb: number;
  gpu: { name: string; vramGb: number } | null;
  tier: string;
  recommendedOllamaModels: string[];
  localStrategy: string;
}

export interface ForgeProviderStatus {
  id: string;
  label: string;
  costTier: "local" | "free_api" | "promo_credit" | "paid";
  protocol: string;
  status: "ready" | "offline" | "untested" | "not_configured" | "auth_error" | "blocked_by_policy" | "cooldown";
  statusReason: string;
  allowedInPolicy: boolean;
  defaultModel: string;
  contextChars: number;
  limitsNote: string;
  privacyNote: string;
  learnedScore: number | null;
  installedModels?: string[];
}

export interface ForgePlanStep {
  id: string;
  title: string;
  role: string;
  status: "pending" | "active" | "done" | "failed";
  note?: string;
}

export interface ForgeActionLog {
  at: string;
  role: string;
  type: string;
  text: string;
  ok: boolean;
}

export interface ForgeTestResult {
  command: string;
  ok: boolean;
  code: number;
  durationMs: number;
  output: string;
  errorSignature?: string | null;
  at: string;
}

export interface ForgeModifiedFile {
  path: string;
  action: "created" | "modified" | "deleted";
  diff: string;
  bytes: number;
  syntaxOk: boolean;
  syntaxError?: string;
  updatedAt: string;
}

export interface ForgeProblem {
  at: string;
  severity: "warn" | "error" | "blocker";
  message: string;
  errorSignature?: string;
  strategyPivot?: string | null;
}

export interface ForgeReview {
  approved: boolean;
  reviewer: string;
  independentModelReviewed?: boolean;
  summary: string;
  issues: string[];
  secretScanClean: boolean;
}

export interface ForgePendingDecision {
  required: boolean;
  kind: "destructive_or_external" | "budget_escalation" | "no_free_provider" | "budget_limit" | "time_limit" | "iteration_limit" | "iteration_or_repair_limit" | string;
  title: string;
  reason: string;
  triggers?: { kind: string; label: string; match: string }[];
  options?: string[];
}

export interface ForgeAttemptRecord {
  attempt: number;
  cycle: number;
  iteration: number;
  strategy: string;
  tier: string;
  provider: string;
  model: string;
  ok: boolean;
  errorSignature: string | null;
  testsPassed: number;
  testsTotal: number;
  modifiedCount: number;
  at: string;
}

export interface ForgeDifficulty {
  level: "simple" | "medium" | "hard";
  score: number;
  targetTier: string;
  reasons: string[];
}

export interface ForgeTeamComposition {
  teamPattern: string;
  agentCount: number;
  roles: { role: string; tier: string; reason: string }[];
  omittedRoles?: string[];
  skipArchitect?: boolean;
  useCompetitive?: boolean;
  competitiveReason?: string;
  initialTier: string;
  escalationLadder: string[];
  rationale: string;
}

export interface ForgeRunState {
  id: string;
  goal: string;
  repoRoot: string;
  worktreePath?: string | null;
  costPolicy: ForgeCostPolicy;
  budgetLocked?: boolean;
  status: "queued" | "scouting" | "planning" | "executing" | "verifying" | "debugging" | "reviewing" | "waiting_approval" | "completed" | "paused" | "blocked" | "failed";
  verdict?: "PASS" | "PAUSED" | "BLOCKED" | "WAITING_APPROVAL" | "FAILED" | null;
  phase: string;
  pauseReason?: string | null;
  pendingDecision?: ForgePendingDecision | null;
  activeRole: string;
  activeExecutor: { provider: string; model: string; costTier: string; reason: string } | null;
  progressPct: number;
  iteration: number;
  maxIterations: number;
  repairCycle: number;
  maxRepairCycles: number;
  maxDurationMs?: number;
  strategy: string;
  strategiesTried: string[];
  attemptHistory?: ForgeAttemptRecord[];
  difficulty?: ForgeDifficulty | null;
  teamComposition?: ForgeTeamComposition | null;
  activeIntelligenceTier?: string | null;
  adaptiveTrace?: { at: string; event: string; fromTier?: string; toTier?: string; tier?: string; rationale?: string }[];
  usageTotals?: { inputTokens: number; outputTokens: number; estimatedPromoUsd?: number };
  impactAnalysis?: { blastRadius: number; riskLevel: string; directImporters: string[]; affectedTests: string[] } | null;
  securityEvents?: { at: string; kind: string; source: string; detail: string }[];
  budgetSnapshot?: {
    experimentSpentUsd: number;
    maxExperimentUsd: number;
    totalSpentUsd: number;
    maxTotalUsd: number;
    outOfPocketUsd?: number;
  } | null;
  autopilot?: {
    zeroConfig?: boolean;
    stages?: { id: string; name: string; role: string; zeroTokens: boolean }[];
    safety?: { safeAuto: boolean; riskLevel: string; triggers: { kind: string; label: string; match: string }[] };
    limits?: { maxIterations: number; maxRepairCycles: number; maxDurationMs: number; costPolicy: string; outOfPocketLimitUsd: number | null; budgetLocked: boolean };
    executionConfig?: { leanSimple: boolean; useWorktree: boolean; useCompetitive: boolean };
    memoryContextSummary?: { lessonsCount: number; failedAttemptsCount: number; decisionsCount: number; adrsCount?: number; projectChecksCount?: number };
  } | null;
  plan: ForgePlanStep[];
  recentActions: ForgeActionLog[];
  testResults: ForgeTestResult[];
  modifiedFiles: ForgeModifiedFile[];
  problems: ForgeProblem[];
  review: ForgeReview | null;
  finalResult: string | null;
  providersUsed: string[];
  resumedCount?: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  rolledBackAt?: string;
}

export interface ForgeAutopilotPlan {
  goal: string;
  repoRoot: string;
  status: string;
  canExecute: boolean;
  decisionRequired: boolean;
  pendingDecision: ForgePendingDecision | null;
  safety: { safeAuto: boolean; riskLevel: string; triggers: { kind: string; label: string; match: string }[]; decisionPrompt: string | null };
  difficulty: ForgeDifficulty;
  teamComposition: ForgeTeamComposition;
  stages: { id: string; name: string; role: string; zeroTokens: boolean }[];
  limits: { maxIterations: number; maxRepairCycles: number; maxDurationMs: number; costPolicy: string; outOfPocketLimitUsd: number | null; budgetLocked: boolean };
  resources: { hardwareTier: string; readyCount: number; readyLocalCount: number; readyApiFreeCount: number; readyPromoCount: number; readyProviders: { id: string; label: string; costCategory: string; defaultModel: string }[] };
}

export interface ForgeMemorySnapshot {
  repoRoot: string;
  updatedAt: string;
  architecture: {
    name: string;
    languages: string[];
    totalFiles: number;
    edgeCount: number;
    testCommands: string[];
    projectRules: string[];
  } | null;
  lessons: {
    id: string;
    errorSignature: string;
    errorSummary: string;
    fixSummary: string;
    utilityScore: number;
    verifiedCount: number;
  }[];
  failedAttempts: {
    id: string;
    errorSignature: string;
    strategy: string;
    attemptSummary: string;
    at: string;
  }[];
  decisions: {
    id: string;
    title: string;
    rationale: string;
    testEvidence: string;
    at: string;
  }[];
  modelStats: Record<string, {
    provider: string;
    model: string;
    role: string;
    calls: number;
    successes: number;
    verifiedRuns: number;
    verifiedPasses: number;
    avgLatencyMs: number;
  }>;
  strategyStats: Record<string, { strategy: string; runs: number; successes: number; avgIterations: number }>;
  taskHistory: { runId: string; goal: string; status: string; testsPassed: boolean; finishedAt: string }[];
}

export interface ForgeSession {
  url: string;
  token: string;
  defaultRepoRoot: string;
  version: string;
}

let cachedSession: ForgeSession | null = null;

/**
 * Zbierz aktualne klucze dostawców i adres Ollamy z ustawień Jarvisa (wyłącznie w RAM).
 * ZASADA BEZPIECZEŃSTWA: klucze płatne (`anthropic`) oraz promocyjne (`modal`) NIE są przekazywane
 * w polityce `zero_cost` ani `local_only`.
 */
export function collectJarvisProviderKeys(costPolicy: ForgeCostPolicy = "zero_cost"): Record<string, string> {
  const s = store.settings;
  const out: Record<string, string> = {};
  if (s.ollamaUrl && s.ollamaUrl.trim()) out.ollamaUrl = s.ollamaUrl.trim();
  if (costPolicy === "local_only") return out;

  const freeIds = ["gemini", "cerebras", "groq", "mistral", "openrouter", "nvidia", "github", "cohere"] as const;
  for (const id of freeIds) {
    const key = orderedKeys(id)[0] || (s.keys && s.keys[id]) || "";
    if (key && key.trim()) out[id] = key.trim();
  }
  const extraKeys = (s.keys || {}) as Record<string, string | undefined>;
  if (extraKeys.sambanova && extraKeys.sambanova.trim()) out.sambanova = extraKeys.sambanova.trim();
  if (extraKeys.cloudflare && extraKeys.cloudflare.trim()) out.cloudflare = extraKeys.cloudflare.trim();
  if (extraKeys.cloudflareAccountId && extraKeys.cloudflareAccountId.trim()) out.cloudflareAccountId = extraKeys.cloudflareAccountId.trim();

  if (costPolicy === "allow_promo_credits" || costPolicy === "allow_credits" || costPolicy === "allow_paid") {
    const modalKey = orderedKeys("modal")[0] || (s.keys && s.keys.modal) || "";
    if (modalKey && modalKey.trim()) out.modal = modalKey.trim();
    if (s.modalUrl && s.modalUrl.trim()) out.modalUrl = s.modalUrl.trim();
  }
  if (costPolicy === "allow_paid") {
    const anthropicKey = orderedKeys("anthropic")[0] || (s.keys && s.keys.anthropic) || "";
    if (anthropicKey && anthropicKey.trim()) out.anthropic = anthropicKey.trim();
  }
  return out;
}

/** Połącz z lokalnym serwerem JARVIS Forge (w Electronie uruchamia go automatycznie). */
export async function connectForge(baseUrl = FORGE_DEFAULT_URL): Promise<ForgeSession> {
  const cleanUrl = baseUrl.replace(/\/+$/, "");

  const d = desktop();
  if (d && d.ensureLocalForge) {
    const ensured = await d.ensureLocalForge(cleanUrl + "/");
    if (ensured && ensured.ok && ensured.token) {
      const healthRes = await fetch(`${cleanUrl}/api/health`);
      const health = await healthRes.json().catch(() => ({}));
      cachedSession = {
        url: ensured.url || cleanUrl,
        token: ensured.token,
        defaultRepoRoot: String(health.defaultRepoRoot || "."),
        version: String(health.version || "1.1.0"),
      };
      return cachedSession;
    }
  }

  const res = await fetch(`${cleanUrl}/api/session`, {
    headers: { "X-Forge-Client": "jarvis-ui" },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.token) {
    throw new Error((data && data.error) || "Lokalny serwer JARVIS Forge nie odpowiada (uruchom: npm run forge:server).");
  }
  cachedSession = {
    url: cleanUrl,
    token: String(data.token),
    defaultRepoRoot: String(data.defaultRepoRoot || "."),
    version: String(data.version || "1.1.0"),
  };
  return cachedSession;
}

async function ensureSession(baseUrl = FORGE_DEFAULT_URL): Promise<ForgeSession> {
  if (cachedSession && cachedSession.url === baseUrl.replace(/\/+$/, "")) return cachedSession;
  return connectForge(baseUrl);
}

export function resetForgeSessionCache(): void {
  cachedSession = null;
}

async function forgeFetch<T>(pathAndQuery: string, init: RequestInit = {}, baseUrl = FORGE_DEFAULT_URL): Promise<T> {
  let sess = await ensureSession(baseUrl);
  const doCall = async (s: ForgeSession) => {
    const res = await fetch(`${s.url}${pathAndQuery}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Forge-Token": s.token,
        "X-Forge-Client": "jarvis-ui",
        ...(init.headers || {}),
      },
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  };

  let { res, data } = await doCall(sess);
  if (res.status === 401) {
    cachedSession = null;
    sess = await connectForge(baseUrl);
    ({ res, data } = await doCall(sess));
  }
  if (!res.ok || !data || data.ok === false) {
    throw new Error((data && data.error) || `Błąd serwera JARVIS Forge (HTTP ${res.status}).`);
  }
  return data as T;
}

export async function getForgeProviders(costPolicy: ForgeCostPolicy = "zero_cost", repoPath?: string): Promise<{
  hardware: ForgeHardwareProfile;
  providers: ForgeProviderStatus[];
}> {
  return forgeFetch("/api/providers/status", {
    method: "POST",
    body: JSON.stringify({
      costPolicy,
      repoPath: repoPath || undefined,
      providerKeys: collectJarvisProviderKeys(costPolicy),
      probe: true,
    }),
  });
}

export async function listForgeRuns(repoPath?: string): Promise<{ repoRoot: string; runs: ForgeRunState[] }> {
  const q = repoPath ? `?path=${encodeURIComponent(repoPath)}` : "";
  return forgeFetch(`/api/runs${q}`);
}

export async function getForgeRun(runId: string, repoPath?: string): Promise<{ run: ForgeRunState }> {
  const q = repoPath ? `?path=${encodeURIComponent(repoPath)}` : "";
  return forgeFetch(`/api/runs/${encodeURIComponent(runId)}${q}`);
}

export async function planAutopilot(opts: {
  goal: string;
  repoPath?: string;
  costPolicy?: ForgeCostPolicy;
}): Promise<{ plan: ForgeAutopilotPlan }> {
  const policy = opts.costPolicy || "zero_cost";
  return forgeFetch("/api/autopilot/plan", {
    method: "POST",
    body: JSON.stringify({
      goal: opts.goal,
      repoPath: opts.repoPath || undefined,
      costPolicy: policy,
      providerKeys: collectJarvisProviderKeys(policy),
    }),
  });
}

/** Uruchom misję JARVIS Autopilot jednym poleceniem (zero ręcznej konfiguracji modelu/zespołu/strategii). */
export async function startAutopilotRun(opts: {
  goal: string;
  repoPath?: string;
  costPolicy?: ForgeCostPolicy;
  initiatedBy?: "user" | "agent";
  wait?: boolean;
}): Promise<{
  ok: boolean;
  runId: string | null;
  status: string;
  verdict?: string;
  decisionRequired?: boolean;
  run: ForgeRunState | null;
  missionPlan?: ForgeAutopilotPlan;
}> {
  const policy = opts.costPolicy || "zero_cost";
  let sess = await ensureSession();
  const doCall = async (s: ForgeSession) => {
    const res = await fetch(`${s.url}/api/autopilot/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forge-Token": s.token,
        "X-Forge-Client": "jarvis-ui",
      },
      body: JSON.stringify({
        goal: opts.goal,
        repoPath: opts.repoPath || undefined,
        costPolicy: policy,
        initiatedBy: opts.initiatedBy || "user",
        wait: opts.wait === true,
        providerKeys: collectJarvisProviderKeys(policy),
      }),
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  };
  let { res, data } = await doCall(sess);
  if (res.status === 401) {
    cachedSession = null;
    sess = await connectForge();
    ({ res, data } = await doCall(sess));
  }
  // `waiting_approval` oraz `blocked` (brak darmowego modelu) zwracają HTTP 200 z pełnym rekordem `run` i `decisionRequired: true`
  if (!res.ok || !data) {
    throw new Error((data && data.error) || `Błąd serwera JARVIS Autopilot (HTTP ${res.status}).`);
  }
  if (data.ok === false && !data.run) {
    throw new Error(data.error || "Misja Autopilota odrzucona.");
  }
  return {
    ok: Boolean(data.ok),
    runId: (data.run && data.run.id) || data.runId || null,
    status: String(data.status || (data.run && data.run.status) || "scouting"),
    verdict: data.verdict,
    decisionRequired: Boolean(data.decisionRequired),
    run: (data.run as ForgeRunState) || null,
    missionPlan: data.missionPlan as ForgeAutopilotPlan | undefined,
  };
}

/** Zatwierdź lub odrzuć zadanie Autopilota oczekujące na decyzję użytkownika (`waiting_approval`). */
export async function decideAutopilotRun(opts: {
  runId: string;
  decision: "approve" | "reject";
  repoPath?: string;
  costPolicy?: ForgeCostPolicy;
  wait?: boolean;
}): Promise<{ ok: boolean; runId: string; status?: string; verdict?: string; run?: ForgeRunState }> {
  const policy = opts.costPolicy || "zero_cost";
  let sess = await ensureSession();
  const res = await fetch(`${sess.url}/api/autopilot/${encodeURIComponent(opts.runId)}/decide`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forge-Token": sess.token,
      "X-Forge-Client": "jarvis-ui",
    },
    body: JSON.stringify({
      decision: opts.decision,
      repoPath: opts.repoPath || undefined,
      wait: opts.wait === true,
      providerKeys: collectJarvisProviderKeys(policy),
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error((data && data.error) || `Błąd decyzji Autopilota (HTTP ${res.status}).`);
  }
  return {
    ok: Boolean(data.ok),
    runId: opts.runId,
    status: data.status,
    verdict: data.verdict,
    run: data.run as ForgeRunState | undefined,
  };
}

export async function startForgeRun(opts: {
  goal: string;
  repoPath?: string;
  costPolicy?: ForgeCostPolicy;
}): Promise<{ runId: string; run: ForgeRunState | null }> {
  const policy = opts.costPolicy || "zero_cost";
  return forgeFetch("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      goal: opts.goal,
      repoPath: opts.repoPath || undefined,
      costPolicy: policy,
      providerKeys: collectJarvisProviderKeys(policy),
    }),
  });
}

export async function pauseForgeRun(runId: string, repoPath?: string): Promise<void> {
  const q = repoPath ? `?path=${encodeURIComponent(repoPath)}` : "";
  await forgeFetch(`/api/runs/${encodeURIComponent(runId)}/pause${q}`, { method: "POST", body: "{}" });
}

export async function cancelForgeRun(runId: string, repoPath?: string): Promise<void> {
  const q = repoPath ? `?path=${encodeURIComponent(repoPath)}` : "";
  await forgeFetch(`/api/runs/${encodeURIComponent(runId)}/cancel${q}`, { method: "POST", body: "{}" });
}

export async function resumeForgeRun(
  runId: string,
  repoPath?: string,
  costPolicy: ForgeCostPolicy = "zero_cost",
): Promise<{ ok: boolean; runId: string; resumed?: boolean; status?: string; run?: ForgeRunState }> {
  return forgeFetch(`/api/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    body: JSON.stringify({ repoPath, costPolicy, providerKeys: collectJarvisProviderKeys(costPolicy) }),
  });
}

export async function rollbackForgeRunClient(runId: string, repoPath?: string): Promise<{ rollback: { restoredCount: number } }> {
  return forgeFetch(`/api/runs/${encodeURIComponent(runId)}/rollback`, {
    method: "POST",
    body: JSON.stringify({ repoPath }),
  });
}

export async function getForgeMemory(repoPath?: string): Promise<{ repoRoot: string; memory: ForgeMemorySnapshot }> {
  const q = repoPath ? `?path=${encodeURIComponent(repoPath)}` : "";
  return forgeFetch(`/api/memory${q}`);
}

/** Subskrybuj żywy strumień zdarzeń SSE z automatycznym wznawianiem po utracie połączenia i dogonieniem stanu przez REST. */
export function subscribeForgeRun(
  runId: string,
  repoPath: string | undefined,
  onUpdate: (state: ForgeRunState) => void,
): () => void {
  let closed = false;
  let activeCtrl: AbortController | null = null;
  let retryDelayMs = 800;
  let terminalReached = false;
  const TERMINAL = new Set(["completed", "blocked", "failed", "paused", "waiting_approval"]);

  const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

  (async () => {
    while (!closed && !terminalReached) {
      activeCtrl = new AbortController();
      try {
        const sess = await ensureSession();
        const q = repoPath ? `?path=${encodeURIComponent(repoPath)}` : "";
        const res = await fetch(`${sess.url}/api/runs/${encodeURIComponent(runId)}/events${q}`, {
          headers: { "X-Forge-Token": sess.token, "X-Forge-Client": "jarvis-ui" },
          signal: activeCtrl.signal,
        });
        if (res.status === 401) {
          cachedSession = null;
          throw new Error("SSE session expired");
        }
        if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
        retryDelayMs = 800;

        // Dogonienie ewentualnych pominiętych zdarzeń po wznowieniu połączenia
        try {
          const latest = await getForgeRun(runId, repoPath);
          if (latest && latest.run && !closed) {
            onUpdate(latest.run);
            if (TERMINAL.has(latest.run.status)) {
              terminalReached = true;
              break;
            }
          }
        } catch { /* ignore transient catch-up error */ }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx = buf.indexOf("\n\n");
          while (idx !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const dataLines = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
            if (dataLines.length) {
              try {
                const parsed = JSON.parse(dataLines.join("\n"));
                if (parsed && parsed.state && parsed.state.id) {
                  const st = parsed.state as ForgeRunState;
                  onUpdate(st);
                  if (TERMINAL.has(st.status)) terminalReached = true;
                }
              } catch { /* ignore malformed frame */ }
            }
            idx = buf.indexOf("\n\n");
          }
        }
      } catch {
        if (closed) break;
      }

      if (!closed && !terminalReached) {
        await sleep(retryDelayMs);
        retryDelayMs = Math.min(8000, Math.round(retryDelayMs * 1.6));
      }
    }
  })();

  return () => {
    closed = true;
    try { activeCtrl?.abort(); } catch { /* ignore */ }
  };
}
