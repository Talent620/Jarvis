// === AUTOCORE · Katalog kanoniczny (jedno źródło prawdy o dostawcach AI) ===
// Czysty moduł BEZ zależności runtime (tylko typy) — mogą go importować lekkie moduły
// (freeMode, modelRouter, usageTelemetry) bez cykli importów. `providers/registry.ts`
// zostaje źródłem implementacji (impl/labels/models/rank); TU są metadane decyzyjne:
// klasa kosztu, prywatność, możliwości, modele per zadanie, endpointy odkrywania, formaty kluczy.
// Wcześniejsze konkurencyjne listy (VISION_PROVIDERS, TASK_MODELS, FREE_PROVIDERS, isKeyless,
// tierOf, DEFAULT_PRICING, prefiksy detectProvider) są z niego WYPROWADZANE.

import type { ProviderId } from "../providers/types";

/** Klasa kosztu — decyduje o bramce budżetu.
 *  local    — działa na urządzeniu/serwerze użytkownika (0 USD),
 *  free     — zweryfikowanie darmowy (np. OpenRouter `:free` z ceną 0 z /models),
 *  freemium — darmowy tier, ALE klucz może mieć włączony billing (nie zakładamy darmowości),
 *  credit   — pula kredytów (Modal: płatne GPU po wyczerpaniu darmowych środków),
 *  paid     — płatne za token,
 *  unknown  — brak danych → traktujemy jak płatne. */
export type CostClass = "local" | "free" | "freemium" | "credit" | "paid" | "unknown";
export type Capability = "text" | "vision" | "tools" | "stream" | "web";
/** Poziom pewności możliwości: zadeklarowana w metadanych / zweryfikowana testem / heurystyka z nazwy. */
export type CapLevel = "declared" | "verified" | "heuristic";
export type Privacy = "local" | "cloud";
export type AuthScheme = "bearer" | "x-api-key" | "x-goog-api-key" | "none";

export interface DiscoverySpec {
  /** Oficjalny endpoint listy modeli. Względny (zaczyna się od „/") = względem adresu serwera użytkownika. */
  modelsUrl: string;
  auth: AuthScheme;
  /** Czy endpoint wystawia CORS dla przeglądarki (inaczej: przez proxy/desktop). */
  browserCors: boolean;
  /** Zapytanie BUDZI płatne zasoby (np. GPU Modal) — wolno tylko na jawne „Podłącz", nigdy z monitoringu. */
  wakesPaidCompute?: boolean;
}

export interface TaskModels {
  /** null = domyślny model dostawcy z registry (PROVIDERS[id].defaultModel). */
  simple: string | null;
  complex: string | null;
  vision: string | null;
}

export interface ProviderProfile {
  id: ProviderId;
  costClass: CostClass;
  privacy: Privacy;
  /** Autoryzacja adresem serwera/WebGPU zamiast klucza. */
  keyless: boolean;
  /** Prefiksy klucza — TYLKO wskazówka kandydata; rozstrzyga test endpointu (discovery). */
  keyPrefixes: string[];
  /** Zadeklarowane możliwości dostawcy (poziom „declared"). Wizja per model: modelHasVision(). */
  caps: Capability[];
  /** Czy obrazy wolno kierować do tego dostawcy (zgodne z dotychczasowym routingiem wizji). */
  visionRouting: boolean;
  taskModels: TaskModels;
  discovery?: DiscoverySpec;
  /** Kolejność w rekomendacji darmowego zestawu (mniejsza = lepsza); brak = nie rekomendujemy jako darmowy. */
  freeRecommend?: number;
  /** Agregator: model BEZ sufiksu `:free` jest płatny (OpenRouter). */
  paidUnlessFreeSuffix?: boolean;
  /** Szacunek kosztu GPU/s dla dostawców rozliczanych czasem (Modal L4 ≈ 0.80 USD/h). */
  usdPerSecond?: number;
}

// Groq: Scout (multimodalny, szybki) do prostych/wizji; Kimi K2 do rozumowania/kodu.
export const GROQ_SCOUT = "meta-llama/llama-4-scout-17b-16e-instruct";
export const GROQ_KIMI = "moonshotai/kimi-k2-instruct";

export const PROFILES: Record<ProviderId, ProviderProfile> = {
  modal: {
    id: "modal", costClass: "credit", privacy: "cloud", keyless: false, keyPrefixes: ["jvllm_", "modal_vllm_"],
    caps: ["text", "tools", "stream"], visionRouting: false,
    taskModels: { simple: null, complex: null, vision: null },
    discovery: { modelsUrl: "/v1/models", auth: "bearer", browserCors: true, wakesPaidCompute: true },
    usdPerSecond: 0.80 / 3600,
  },
  anthropic: {
    id: "anthropic", costClass: "paid", privacy: "cloud", keyless: false, keyPrefixes: ["sk-ant-"],
    caps: ["text", "vision", "tools", "stream", "web"], visionRouting: true,
    taskModels: { simple: "claude-haiku-4-5", complex: "claude-opus-4-8", vision: "claude-opus-4-8" },
    discovery: { modelsUrl: "https://api.anthropic.com/v1/models", auth: "x-api-key", browserCors: true },
  },
  gemini: {
    id: "gemini", costClass: "freemium", privacy: "cloud", keyless: false, keyPrefixes: ["AIza"],
    caps: ["text", "vision", "tools", "stream", "web"], visionRouting: true,
    taskModels: { simple: "gemini-2.5-flash-lite", complex: "gemini-2.5-flash", vision: "gemini-2.5-flash" },
    discovery: { modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models", auth: "x-goog-api-key", browserCors: true },
    freeRecommend: 1,
  },
  groq: {
    id: "groq", costClass: "freemium", privacy: "cloud", keyless: false, keyPrefixes: ["gsk_"],
    caps: ["text", "tools", "stream"], visionRouting: false,
    taskModels: { simple: GROQ_SCOUT, complex: GROQ_KIMI, vision: GROQ_SCOUT },
    discovery: { modelsUrl: "https://api.groq.com/openai/v1/models", auth: "bearer", browserCors: true },
    freeRecommend: 3,
  },
  cerebras: {
    id: "cerebras", costClass: "freemium", privacy: "cloud", keyless: false, keyPrefixes: ["csk-"],
    caps: ["text", "tools", "stream"], visionRouting: false,
    taskModels: { simple: "llama3.1-8b", complex: "llama-3.3-70b", vision: "llama-3.3-70b" },
    discovery: { modelsUrl: "https://api.cerebras.ai/v1/models", auth: "bearer", browserCors: true },
    freeRecommend: 2,
  },
  mistral: {
    id: "mistral", costClass: "freemium", privacy: "cloud", keyless: false, keyPrefixes: [],
    caps: ["text", "vision", "tools", "stream"], visionRouting: true,
    taskModels: { simple: "mistral-small-latest", complex: "mistral-large-latest", vision: "pixtral-12b-2409" },
    discovery: { modelsUrl: "https://api.mistral.ai/v1/models", auth: "bearer", browserCors: true },
    freeRecommend: 4,
  },
  cohere: {
    id: "cohere", costClass: "freemium", privacy: "cloud", keyless: false, keyPrefixes: [],
    caps: ["text", "tools", "stream"], visionRouting: false,
    taskModels: { simple: "command-r7b-12-2024", complex: "command-a-03-2025", vision: "command-a-03-2025" },
    discovery: { modelsUrl: "https://api.cohere.com/v1/models", auth: "bearer", browserCors: false },
  },
  openrouter: {
    id: "openrouter", costClass: "freemium", privacy: "cloud", keyless: false, keyPrefixes: ["sk-or-"],
    caps: ["text", "vision", "tools", "stream", "web"], visionRouting: true,
    taskModels: {
      simple: "meta-llama/llama-3.3-70b-instruct:free",
      complex: "meta-llama/llama-3.1-405b-instruct",
      vision: "google/gemini-2.0-flash-exp:free",
    },
    discovery: { modelsUrl: "https://openrouter.ai/api/v1/models", auth: "bearer", browserCors: true },
    freeRecommend: 5,
    paidUnlessFreeSuffix: true,
  },
  nvidia: {
    id: "nvidia", costClass: "freemium", privacy: "cloud", keyless: false, keyPrefixes: ["nvapi-"],
    caps: ["text", "tools", "stream"], visionRouting: false,
    taskModels: { simple: "meta/llama-3.3-70b-instruct", complex: "meta/llama-3.1-405b-instruct", vision: "meta/llama-3.3-70b-instruct" },
    discovery: { modelsUrl: "https://integrate.api.nvidia.com/v1/models", auth: "bearer", browserCors: false },
  },
  github: {
    // GitHub Models: limitowany darmowy dostęp, ale z opcją płatnego billingu → w trybie darmowym pomijany (jak dotąd).
    id: "github", costClass: "paid", privacy: "cloud", keyless: false, keyPrefixes: ["ghp_", "gho_", "ghs_", "ghr_", "ghu_", "github_pat_"],
    caps: ["text", "vision", "tools", "stream"], visionRouting: true,
    taskModels: { simple: "openai/gpt-4o-mini", complex: "openai/gpt-4o", vision: "openai/gpt-4o" },
    discovery: { modelsUrl: "https://models.github.ai/catalog/models", auth: "bearer", browserCors: false },
  },
  ollama: {
    id: "ollama", costClass: "local", privacy: "local", keyless: true, keyPrefixes: [],
    caps: ["text", "tools", "stream"], visionRouting: false,
    taskModels: { simple: "qwen3:1.7b", complex: "qwen3.5:4b", vision: "gemma3:4b-it-qat" },
    discovery: { modelsUrl: "/api/tags", auth: "none", browserCors: true },
  },
  webllm: {
    id: "webllm", costClass: "local", privacy: "local", keyless: true, keyPrefixes: [],
    caps: ["text", "stream"], visionRouting: false,
    taskModels: { simple: null, complex: null, vision: null },
  },
};

export const PROFILE_LIST: ProviderProfile[] = Object.values(PROFILES);

// ---------- Wyprowadzone widoki (zamiast konkurencyjnych list w modułach) ----------

/** Dostawcy bez klucza (lokalni). */
export const isKeylessProvider = (p: ProviderId): boolean => !!PROFILES[p]?.keyless;

/** Dostawcy, do których router wolno kierować obrazy. */
export const VISION_ROUTABLE = new Set<ProviderId>(PROFILE_LIST.filter((p) => p.visionRouting).map((p) => p.id));

/** Dostawcy z realnym darmowym tierem lub lokalni (tryb darmowy). „paid" (Anthropic, GitHub) odpadają. */
export const FREE_TIER_PROVIDERS = new Set<ProviderId>(PROFILE_LIST.filter((p) => p.costClass !== "paid").map((p) => p.id));

/** Darmowa rekomendacja w kolejności jakości (źródło dla doradcy mózgu). */
export const FREE_RECOMMENDED: ProviderId[] = PROFILE_LIST.filter((p) => p.freeRecommend !== undefined)
  .sort((a, b) => (a.freeRecommend as number) - (b.freeRecommend as number))
  .map((p) => p.id);

/** Model dla zadania; `defaultOf` dostarcza domyślny model z registry (null w profilu). */
export function taskModelFor(p: ProviderId, kind: keyof TaskModels, defaultOf: (p: ProviderId) => string): string {
  return PROFILES[p]?.taskModels[kind] ?? defaultOf(p);
}

/** Kandydaci dostawcy po prefiksie klucza (najdłuższy prefiks wygrywa). Pusty = nieznany format. */
export function providerCandidatesByPrefix(key: string): ProviderId[] {
  const k = (key || "").trim();
  if (!k) return [];
  const hits: { id: ProviderId; len: number }[] = [];
  for (const p of PROFILE_LIST) for (const pre of p.keyPrefixes) if (k.startsWith(pre)) hits.push({ id: p.id, len: pre.length });
  hits.sort((a, b) => b.len - a.len);
  return Array.from(new Set(hits.map((h) => h.id)));
}

// Heurystyka wizji z nazwy modelu (poziom „heuristic") — dla modeli odkrytych bez metadanych modalności.
const VISION_NAME = /vision|pixtral|gemini|gpt-4o|gpt-4\.1|gpt-5|claude|llama-4|scout|maverick|gemma-?3|llava|qwen.?2(\.5)?-?vl|qwen-?vl|minicpm-v|moondream|-vl\b/i;
export function modelHasVisionHeuristic(model: string): boolean {
  return VISION_NAME.test(model || "");
}

// ---------- Cennik (USD / 1M tokenów) ----------

export interface ModelPrice { in: number; out: number }

/** Domyślny cennik znanych modeli (re-eksportowany jako DEFAULT_PRICING w usageTelemetry). */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Anthropic
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  // Gemini
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
  // Groq (Faza 4)
  "meta-llama/llama-4-scout-17b-16e-instruct": { in: 0.11, out: 0.34 },
  "moonshotai/kimi-k2-instruct": { in: 1, out: 3 },
  "llama-3.3-70b-versatile": { in: 0.59, out: 0.79 },
  "llama-3.1-8b-instant": { in: 0.05, out: 0.08 },
};

/** Ostrożny szacunek dla płatnego modelu bez cennika — NIE zakładamy 0 (inaczej budżet byłby ślepy). */
export const CONSERVATIVE_PRICE: ModelPrice = { in: 3, out: 15 };

/**
 * Klasa kosztu KONKRETNEGO modelu. Model `:free` OpenRoutera jest „free" tylko gdy discovery
 * potwierdziło cenę 0 (`verifiedFree`); bez tego zostaje klasą dostawcy (freemium).
 */
export function costClassOf(p: ProviderId, model: string, verifiedFree?: (p: ProviderId, m: string) => boolean): CostClass {
  const base = PROFILES[p]?.costClass ?? "unknown";
  if (base === "local") return "local";
  if (verifiedFree?.(p, model)) return "free";
  if (PROFILES[p]?.paidUnlessFreeSuffix && !/:free$/.test(model || "")) return "paid";
  return base;
}

/**
 * Cena do rozliczeń budżetu: nadpisanie z configu > cennik > 0 dla local/free > (freemium bez cennika:
 * 0 tylko dla modelu `:free`) > ostrożny szacunek. Zwraca też, czy to szacunek.
 */
export function budgetPriceFor(
  p: ProviderId,
  model: string,
  overrides?: Record<string, ModelPrice>,
  verifiedFree?: (p: ProviderId, m: string) => boolean,
): { price: ModelPrice; estimated: boolean } {
  const known = overrides?.[model] || MODEL_PRICING[model];
  if (known) return { price: known, estimated: false };
  const cls = costClassOf(p, model, verifiedFree);
  if (cls === "local" || cls === "free") return { price: { in: 0, out: 0 }, estimated: false };
  if (cls === "credit") return { price: { in: 0, out: 0 }, estimated: true }; // GPU liczone czasem (usdPerSecond)
  // Freemium bez cennika: liczymy 0, ale jako SZACUNEK (billing klucza nieznany — UI to pokazuje).
  if (cls === "freemium") return { price: { in: 0, out: 0 }, estimated: true };
  return { price: CONSERVATIVE_PRICE, estimated: true };
}
