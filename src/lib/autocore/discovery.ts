// === AUTOCORE · Auto-discovery dostawców i „Podłącz nową usługę AI" (Magic Paste) ===
// Zasady:
//  • Prefiks klucza daje tylko KANDYDATÓW; rozstrzyga rzeczywiste zapytanie do endpointu /models.
//  • `/models` potwierdza klucz i listę modeli (capabilities: "declared" / "heuristic"), ale
//    NIE oznacza samo w sobie, że generacja/narzędzia działają („functionalVerified: false").
//  • Modal (/v1/models) budzi GPU i kosztuje kredyty — odpytywany WYŁĄCZNIE przy jawnym
//    podłączeniu z podanym adresem, nigdy z monitoringu w tle.
//  • Klucze są SCALANE (merge, deduplikacja linii), nigdy nie nadpisują istniejących.
import { loadJson, saveJson } from "../lsJson";
import { store } from "../store";
import { appTokenHeader, fetchTimeout } from "../http";
import type { ProviderId } from "../providers/types";
import { PROVIDERS, normalizeModalEndpoint } from "../providers/registry";
import {
  PROFILES, PROFILE_LIST, providerCandidatesByPrefix, modelHasVisionHeuristic,
  type Capability, type CapLevel,
} from "./catalog";
import { markVerifiedFree, registerNewService } from "./budget";

const DISC_KEY = "jarvis.autocore.discovered.v1";
const MIGRATED_KEY = "jarvis.autocore.migrated.v1";

export interface DiscoveredModel {
  id: string;
  capabilities: Capability[];
  capLevel: CapLevel;
  verifiedFree?: boolean;
}

export interface DiscoveryResult {
  provider: ProviderId;
  ok: boolean;
  authOk: boolean;
  functionalVerified: false; // /models samo w sobie nie dowodzi działania generacji
  needsProxy?: boolean;
  latencyMs: number;
  models: DiscoveredModel[];
  error?: string;
}

export interface ConnectResult {
  ok: boolean;
  provider?: ProviderId;
  addedKey: boolean;
  pendingBudgetApproval: boolean;
  discovery?: DiscoveryResult;
  message: string;
}

type DiscoveredStore = Partial<Record<ProviderId, { at: number; models: DiscoveredModel[] }>>;
let discCache: DiscoveredStore | null = null;
const D = (): DiscoveredStore => (discCache ??= loadJson<DiscoveredStore>(DISC_KEY, {}));

export function discoveredModelsFor(p: ProviderId): DiscoveredModel[] {
  return D()[p]?.models || [];
}

/** Złóż nagłówki auth zgodnie ze schematem z katalogu. */
function authHeaders(p: ProviderId, key: string): Record<string, string> {
  const auth = PROFILES[p]?.discovery?.auth;
  if (auth === "bearer") return { authorization: `Bearer ${key}` };
  if (auth === "x-api-key") return { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
  if (auth === "x-goog-api-key") return { "x-goog-api-key": key };
  return {};
}

function resolveModelsUrl(p: ProviderId, endpoint?: string): string | null {
  const spec = PROFILES[p]?.discovery;
  if (!spec) return null;
  if (p === "modal") {
    const norm = normalizeModalEndpoint(endpoint || store.settings.modalUrl || "");
    return norm ? norm.replace(/\/chat\/completions$/i, "/models") : null;
  }
  if (p === "ollama") {
    const base = (endpoint || store.settings.ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
    return `${base}/api/tags`;
  }
  return spec.modelsUrl;
}

/** Parsuj odpowiedź /models z różnych dostawców do wspólnego formatu. */
export function parseModelsPayload(p: ProviderId, data: unknown): { models: DiscoveredModel[]; verifiedFreeIds: string[] } {
  const d = data as Record<string, unknown> | null;
  if (!d) return { models: [], verifiedFreeIds: [] };
  const verifiedFreeIds: string[] = [];
  const models: DiscoveredModel[] = [];

  if (p === "gemini" && Array.isArray(d.models)) {
    for (const raw of d.models as Record<string, unknown>[]) {
      const id = String(raw.name || "").replace(/^models\//, "");
      if (!id) continue;
      const methods = Array.isArray(raw.supportedGenerationMethods) ? raw.supportedGenerationMethods.map(String) : [];
      if (methods.length && !methods.includes("generateContent")) continue;
      const caps: Capability[] = ["text", "tools", "stream"];
      if (modelHasVisionHeuristic(id)) caps.push("vision");
      models.push({ id, capabilities: caps, capLevel: "declared" });
    }
    return { models, verifiedFreeIds };
  }

  if (p === "ollama" && Array.isArray(d.models)) {
    for (const raw of d.models as Record<string, unknown>[]) {
      const id = String(raw.name || raw.model || "");
      if (!id) continue;
      const caps: Capability[] = ["text", "stream"];
      if (modelHasVisionHeuristic(id)) caps.push("vision");
      models.push({ id, capabilities: caps, capLevel: "heuristic" });
    }
    return { models, verifiedFreeIds };
  }

  const arr = Array.isArray(d.data) ? d.data : Array.isArray(d.models) ? d.models : [];
  for (const raw of arr as Record<string, unknown>[]) {
    const id = String(raw.id || raw.name || "");
    if (!id) continue;
    const caps: Capability[] = ["text", "stream"];
    let level: CapLevel = "heuristic";

    // OpenRouter: jawne architecture.input_modalities, supported_parameters i pricing
    const arch = raw.architecture as { input_modalities?: unknown[] } | undefined;
    const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters.map(String) : [];
    const mistralCaps = raw.capabilities as { vision?: boolean; function_calling?: boolean } | undefined;
    if (arch?.input_modalities || params.length) {
      level = "declared";
      if (arch?.input_modalities?.map(String).includes("image")) caps.push("vision");
      if (params.includes("tools")) caps.push("tools");
    } else if (mistralCaps) {
      level = "declared";
      if (mistralCaps.vision) caps.push("vision");
      if (mistralCaps.function_calling) caps.push("tools");
    } else {
      if (modelHasVisionHeuristic(id)) caps.push("vision");
      if (PROFILES[p].caps.includes("tools")) caps.push("tools");
    }

    let isFree = false;
    const pr = raw.pricing as { prompt?: unknown; completion?: unknown } | undefined;
    if (p === "openrouter" && pr && String(pr.prompt) === "0" && String(pr.completion) === "0") {
      isFree = true;
      verifiedFreeIds.push(id);
    }
    models.push({ id, capabilities: Array.from(new Set(caps)), capLevel: level, ...(isFree ? { verifiedFree: true } : {}) });
  }
  return { models, verifiedFreeIds };
}

/** Sprawdź dostawcę i pobierz listę modeli bez zgadywania możliwości. */
export async function probeProvider(
  p: ProviderId,
  apiKey: string,
  opts: { endpoint?: string; proxyUrl?: string; fetchFn?: typeof fetch } = {},
): Promise<DiscoveryResult> {
  const url = resolveModelsUrl(p, opts.endpoint);
  if (!url) {
    return { provider: p, ok: false, authOk: false, functionalVerified: false, latencyMs: 0, models: [], error: "Brak adresu endpointu." };
  }
  const spec = PROFILES[p].discovery!;
  const proxy = (opts.proxyUrl ?? store.settings.proxyUrl ?? "").trim().replace(/\/+$/, "");
  const needsProxy = !spec.browserCors && !proxy && typeof window !== "undefined";
  if (needsProxy) {
    return {
      provider: p, ok: false, authOk: false, functionalVerified: false, needsProxy: true, latencyMs: 0, models: [],
      error: `${PROVIDERS[p].label} wymaga proxy BFF lub trybu desktop (CORS).`,
    };
  }
  const target = !spec.browserCors && proxy ? `${proxy}/passthrough?u=${encodeURIComponent(url)}` : url;
  const headers: Record<string, string> = { ...authHeaders(p, apiKey.trim()), ...(!spec.browserCors && proxy ? appTokenHeader() : {}) };
  const t0 = Date.now();
  try {
    const res = opts.fetchFn
      ? await opts.fetchFn(target, { method: "GET", headers })
      : await fetchTimeout(target, { method: "GET", headers }, 10_000);
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { provider: p, ok: false, authOk: false, functionalVerified: false, latencyMs, models: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => null);
    const { models, verifiedFreeIds } = parseModelsPayload(p, data);
    if (verifiedFreeIds.length) markVerifiedFree(p, verifiedFreeIds);
    D()[p] = { at: Date.now(), models };
    saveJson(DISC_KEY, D());
    return { provider: p, ok: true, authOk: true, functionalVerified: false, latencyMs, models };
  } catch (e) {
    return {
      provider: p, ok: false, authOk: false, functionalVerified: false, latencyMs: Date.now() - t0, models: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Scal klucz z istniejącą listą (nowy na początek, bez duplikatów, bez utraty starych kluczy). */
export function mergeProviderKey(existing: string, added: string): { merged: string; added: boolean } {
  const k = (added || "").trim();
  if (!k) return { merged: existing || "", added: false };
  const lines = (existing || "").split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (lines.includes(k)) return { merged: lines.join("\n"), added: false };
  return { merged: [k, ...lines].join("\n"), added: true };
}

/** Kolejność kandydatów dla klucza: najpierw po prefiksie, potem pozostali bez prefiksu (z wyłączeniem płatnego GPU Modal bez URL). */
export function candidateOrderForKey(key: string, endpoint?: string): ProviderId[] {
  const byPrefix = providerCandidatesByPrefix(key);
  if (byPrefix.length) return byPrefix;
  const others: ProviderId[] = ["mistral", "cohere", "openrouter", "groq", "cerebras", "gemini", "anthropic", "nvidia", "github"];
  return endpoint?.trim() ? ["modal", ...others] : others;
}

/**
 * Jeden przycisk „PODŁĄCZ NOWĄ USŁUGĘ AI": wykryj dostawcę po rzeczywistym endpoincie,
 * pobierz i sklasyfikuj modele, scal klucz i zgłoś do bramki budżetu.
 */
export async function connectService(
  rawKey: string,
  opts: { endpoint?: string; proxyUrl?: string; fetchFn?: typeof fetch } = {},
): Promise<ConnectResult> {
  const key = (rawKey || "").trim();
  if (!key) return { ok: false, addedKey: false, pendingBudgetApproval: false, message: "Wklej klucz API." };

  const cands = candidateOrderForKey(key, opts.endpoint);
  let lastDisc: DiscoveryResult | undefined;
  let corsNeedProxy: DiscoveryResult | undefined;

  for (const p of cands) {
    if (p === "modal" && !opts.endpoint?.trim() && !store.settings.modalUrl?.trim()) continue;
    const disc = await probeProvider(p, key, opts);
    lastDisc = disc;
    if (disc.needsProxy) { corsNeedProxy = disc; continue; }
    if (!disc.ok) continue;

    const prev = store.settings.keys[p] || "";
    const { merged, added } = mergeProviderKey(prev, key);
    const patch: Partial<typeof store.settings> = { keys: { ...store.settings.keys, [p]: merged } };
    if (p === "modal" && opts.endpoint?.trim()) patch.modalUrl = opts.endpoint.trim();
    store.setSettings(patch);

    const sampleModel = disc.models[0]?.id || PROVIDERS[p].defaultModel;
    const pending = added ? registerNewService(p, sampleModel) : false;
    return {
      ok: true,
      provider: p,
      addedKey: added,
      pendingBudgetApproval: pending,
      discovery: disc,
      message: pending
        ? `Podłączono ${PROVIDERS[p].label} (${disc.models.length} modeli, ${disc.latencyMs} ms). Usługa może być płatna — zatwierdź limit budżetu, aby ją aktywować.`
        : `Podłączono ${PROVIDERS[p].label} (${disc.models.length} modeli, ${disc.latencyMs} ms). Uwaga: sama lista /models nie potwierdza jeszcze pełnej generacji.`,
    };
  }

  if (corsNeedProxy) {
    return { ok: false, addedKey: false, pendingBudgetApproval: false, discovery: corsNeedProxy, message: corsNeedProxy.error || "Wymaga proxy." };
  }
  return {
    ok: false,
    addedKey: false,
    pendingBudgetApproval: false,
    discovery: lastDisc,
    message: `Nie udało się zweryfikować klucza (${lastDisc?.error || "brak odpowiedzi 200 OK"}).`,
  };
}

/**
 * Jednorazowa migracja istniejącej konfiguracji: zapamiętuje już obecne klucze bez ich blokowania
 * (grandfathering) i bez utraty żadnych połączeń.
 */
export function migrateExistingConfig(): { migratedProviders: ProviderId[] } {
  const already = loadJson<boolean>(MIGRATED_KEY, false);
  const configured = PROFILE_LIST.filter((p) => !p.keyless && !!store.settings.keys[p.id]?.trim()).map((p) => p.id);
  if (!already) saveJson(MIGRATED_KEY, true);
  return { migratedProviders: configured };
}

/** Tylko testy. */
export function resetDiscovery(): void { discCache = {}; saveJson(DISC_KEY, {}); saveJson(MIGRATED_KEY, false); }
