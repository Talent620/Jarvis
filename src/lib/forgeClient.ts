// === Klient JARVIS FORGE (łącznik UI React <-> lokalny serwer Forge :3220) ===
// Zero konfiguracji dla użytkownika: automatycznie korzysta z lokalnego serwera
// (w Electronie uruchamia go przez IPC `ensureLocalForge`) oraz pobiera już wpisane
// klucze darmowych dostawców i adres Ollamy z `store.settings` (wyłącznie w RAM). S9-safe.

import { desktop } from "./desktop";
import { orderedKeys } from "./keys";
import { store } from "./store";

export const FORGE_DEFAULT_URL = "http://127.0.0.1:3220";

export type ForgeCostPolicy = "zero_cost" | "local_only" | "allow_credits" | "allow_paid";

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
  summary: string;
  issues: string[];
  secretScanClean: boolean;
}

export interface ForgeRunState {
  id: string;
  goal: string;
  repoRoot: string;
  costPolicy: ForgeCostPolicy;
  status: "queued" | "scouting" | "planning" | "executing" | "verifying" | "debugging" | "reviewing" | "completed" | "paused" | "blocked" | "failed";
  phase: string;
  activeRole: string;
  activeExecutor: { provider: string; model: string; costTier: string; reason: string } | null;
  progressPct: number;
  iteration: number;
  maxIterations: number;
  repairCycle: number;
  maxRepairCycles: number;
  strategy: string;
  strategiesTried: string[];
  plan: ForgePlanStep[];
  recentActions: ForgeActionLog[];
  testResults: ForgeTestResult[];
  modifiedFiles: ForgeModifiedFile[];
  problems: ForgeProblem[];
  review: ForgeReview | null;
  finalResult: string | null;
  providersUsed: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  rolledBackAt?: string;
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

/** Zbierz aktualne klucze dostawców i adres Ollamy z ustawień Jarvisa (wyłącznie w RAM). */
export function collectJarvisProviderKeys(): Record<string, string> {
  const s = store.settings;
  const out: Record<string, string> = {};
  const ids = ["gemini", "cerebras", "groq", "mistral", "openrouter", "nvidia", "github", "cohere", "modal", "anthropic"] as const;
  for (const id of ids) {
    const key = orderedKeys(id)[0] || (s.keys && s.keys[id]) || "";
    if (key && key.trim()) out[id] = key.trim();
  }
  if (s.ollamaUrl && s.ollamaUrl.trim()) out.ollamaUrl = s.ollamaUrl.trim();
  if (s.modalUrl && s.modalUrl.trim()) out.modalUrl = s.modalUrl.trim();
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
        version: String(health.version || "1.0.0"),
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
    version: String(data.version || "1.0.0"),
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

export async function getForgeProviders(costPolicy: ForgeCostPolicy = "zero_cost"): Promise<{
  hardware: ForgeHardwareProfile;
  providers: ForgeProviderStatus[];
}> {
  return forgeFetch("/api/providers/status", {
    method: "POST",
    body: JSON.stringify({ costPolicy, providerKeys: collectJarvisProviderKeys(), probe: true }),
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

export async function startForgeRun(opts: {
  goal: string;
  repoPath?: string;
  costPolicy?: ForgeCostPolicy;
}): Promise<{ runId: string; run: ForgeRunState | null }> {
  return forgeFetch("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      goal: opts.goal,
      repoPath: opts.repoPath || undefined,
      costPolicy: opts.costPolicy || "zero_cost",
      providerKeys: collectJarvisProviderKeys(),
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

export async function resumeForgeRun(runId: string, repoPath?: string, costPolicy: ForgeCostPolicy = "zero_cost"): Promise<void> {
  await forgeFetch(`/api/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    body: JSON.stringify({ repoPath, costPolicy, providerKeys: collectJarvisProviderKeys() }),
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

/** Subskrybuj żywy strumień zdarzeń SSE z bezpiecznym nagłówkiem X-Forge-Token. Zwraca funkcję rozłączającą. */
export function subscribeForgeRun(
  runId: string,
  repoPath: string | undefined,
  onUpdate: (state: ForgeRunState) => void,
): () => void {
  let closed = false;
  const ctrl = new AbortController();

  (async () => {
    try {
      const sess = await ensureSession();
      const q = repoPath ? `?path=${encodeURIComponent(repoPath)}` : "";
      const res = await fetch(`${sess.url}/api/runs/${encodeURIComponent(runId)}/events${q}`, {
        headers: { "X-Forge-Token": sess.token, "X-Forge-Client": "jarvis-ui" },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) return;
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
              if (parsed && parsed.state && parsed.state.id) onUpdate(parsed.state as ForgeRunState);
            } catch { /* ignore malformed frame */ }
          }
          idx = buf.indexOf("\n\n");
        }
      }
    } catch { /* disconnected or aborted */ }
  })();

  return () => {
    closed = true;
    ctrl.abort();
  };
}
