import { askAnthropic } from "./anthropic";
import { makeOpenAICompatible } from "./openai";
import { askGemini } from "./gemini";
import { askWebllm } from "./webllm";
import { askOllamaNative } from "./ollama";
import { WEBLLM_MODELS, WEBLLM_DEFAULT_MODEL } from "../webllm";
import { store } from "../store";
import type { AskCtx, Msg, ProviderId, ProviderMeta, FallbackReasonKind } from "./types";

// Tylko modele „rozumujące" rozumieją dyrektywę /no_think — dla gemma/llama to zbędny token.
const REASONING_LOCAL = /qwen3|deepseek|qwq|-r1|reason|think|marco|phi-?4/i;

/** Pure: dopnij „/no_think" do ostatniej wiadomości użytkownika, ale TYLKO dla modeli rozumujących. */
export function injectNoThink(history: Msg[], model: string): Msg[] {
  if (!REASONING_LOCAL.test(model || "")) return history;
  const h = history.slice();
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].role === "user") { h[i] = { ...h[i], content: `${h[i].content} /no_think` }; break; }
  }
  return h;
}

// Lokalny model (Ollama) — endpoint z ustawień, bez klucza, pełna prywatność.
// Tuning pod ~4 GB VRAM (Zadanie 4): keep_alive trzyma model w VRAM między turami (mniej
// przeładowań), options.num_ctx/num_gpu sterują pamięcią i offloadem na GPU.
function askOllama(ctx: AskCtx) {
  const s = store.settings;
  const base = (s.ollamaUrl || "http://localhost:11434").replace(/\/$/, "");
  const options: Record<string, number> = { num_ctx: s.ollamaNumCtx ?? 4096, num_gpu: s.ollamaNumGpu ?? -1 };
  if (s.ollamaNumPredict && s.ollamaNumPredict > 0) options.num_predict = s.ollamaNumPredict; // krótsza odpowiedź = szybsza
  // Tryb szybki: dopnij „/no_think" do ostatniej wiadomości użytkownika — modele rozumujące
  // (qwen3, deepseek-r1) pomijają wtedy długie „myślenie" i odpowiadają od razu. Dla modeli
  // bez rozumowania (gemma/llama) nie dokładamy zbędnego tokenu.
  let useCtx = ctx;
  if (s.ollamaNoThink) {
    const h = injectNoThink(ctx.history, ctx.model);
    if (h !== ctx.history) useCtx = { ...ctx, history: h };
  }
  return askOllamaNative(useCtx, { base, think: !s.ollamaNoThink, options });
}

// Katalog dostawców i darmowych/mocnych modeli. „rank" steruje trybem auto.
export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  anthropic: {
    id: "anthropic",
    label: "Claude (Anthropic)",
    rank: 100,
    keysUrl: "https://platform.claude.com",
    defaultModel: "claude-opus-4-8",
    impl: askAnthropic,
    models: [
      { id: "claude-opus-4-8", label: "Opus 4.8 — maksymalna inteligencja" },
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6 — szybki i bystry" },
      { id: "claude-haiku-4-5", label: "Haiku 4.5 — najszybszy" },
    ],
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini (AI Studio)",
    rank: 80,
    keysUrl: "https://aistudio.google.com",
    defaultModel: "gemini-2.5-flash",
    impl: askGemini,
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash — #1 tool-calling, darmowy" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite — najszybszy" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro — najmocniejszy (limit 50/dzień)" },
    ],
  },
  groq: {
    id: "groq",
    label: "Groq (błyskawiczny)",
    rank: 70,
    keysUrl: "https://console.groq.com",
    defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    impl: makeOpenAICompatible("https://api.groq.com/openai/v1/chat/completions"),
    models: [
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout — szybki, multimodalny" },
      { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2 — mocne rozumowanie i kod" },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B — darmowy" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B — najszybszy" },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
      { id: "qwen/qwen3-32b", label: "Qwen3 32B" },
    ],
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras (najszybszy, darmowy ~2000 tok/s)",
    rank: 72,
    keysUrl: "https://cloud.cerebras.ai",
    defaultModel: "llama-3.3-70b",
    impl: makeOpenAICompatible("https://api.cerebras.ai/v1/chat/completions"),
    models: [
      { id: "llama-3.3-70b", label: "Llama 3.3 70B — błyskawiczny" },
      { id: "llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout" },
      { id: "qwen-3-32b", label: "Qwen3 32B" },
      { id: "llama3.1-8b", label: "Llama 3.1 8B — najszybszy" },
    ],
  },
  mistral: {
    id: "mistral",
    label: "Mistral (szeroki darmowy tier, wizja)",
    rank: 55,
    keysUrl: "https://console.mistral.ai",
    defaultModel: "mistral-small-latest",
    impl: makeOpenAICompatible("https://api.mistral.ai/v1/chat/completions"),
    models: [
      { id: "mistral-small-latest", label: "Mistral Small — darmowy" },
      { id: "mistral-large-latest", label: "Mistral Large — najmocniejszy" },
      { id: "open-mistral-nemo", label: "Mistral Nemo" },
      { id: "pixtral-12b-2409", label: "Pixtral 12B — wizja" },
    ],
  },
  cohere: {
    id: "cohere",
    label: "Cohere Command (darmowy tier)",
    rank: 45,
    keysUrl: "https://dashboard.cohere.com/api-keys",
    defaultModel: "command-a-03-2025",
    // API zgodne z OpenAI (endpoint „compatibility"). Wspiera narzędzia (function calling).
    impl: makeOpenAICompatible("https://api.cohere.ai/compatibility/v1/chat/completions"),
    needsProxy: true, // Cohere zwykle nie wystawia CORS dla przeglądarki — kieruj przez proxy/desktop.
    models: [
      { id: "command-a-03-2025", label: "Command A — najmocniejszy" },
      { id: "command-r-plus-08-2024", label: "Command R+ — mocny" },
      { id: "command-r-08-2024", label: "Command R — zrównoważony" },
      { id: "command-r7b-12-2024", label: "Command R7B — najszybszy" },
    ],
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter (35+ modeli)",
    rank: 60,
    keysUrl: "https://openrouter.ai",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    impl: makeOpenAICompatible("https://openrouter.ai/api/v1/chat/completions", {
      extraHeaders: { "HTTP-Referer": "https://jarvis.app", "X-Title": "JARVIS" },
      onlineSuffix: true,
    }),
    models: [
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)" },
      { id: "cognitivecomputations/dolphin3.0-mistral-24b:free", label: "Dolphin 3.0 — bez cenzury (free)" },
      { id: "cognitivecomputations/dolphin3.0-r1-mistral-24b:free", label: "Dolphin 3.0 R1 — bez cenzury (free)" },
      { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (free)" },
      { id: "deepseek/deepseek-chat-v3-0324:free", label: "DeepSeek V3 (free)" },
      { id: "qwen/qwen-2.5-72b-instruct:free", label: "Qwen 2.5 72B (free)" },
      { id: "meta-llama/llama-3.1-405b-instruct", label: "Llama 3.1 405B" },
    ],
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA NIM (bez limitu dziennego)",
    rank: 50,
    keysUrl: "https://build.nvidia.com",
    defaultModel: "meta/llama-3.3-70b-instruct",
    impl: makeOpenAICompatible("https://integrate.api.nvidia.com/v1/chat/completions"),
    needsProxy: true,
    models: [
      { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
      { id: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B" },
      { id: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B" },
      { id: "qwen/qwen2.5-coder-32b-instruct", label: "Qwen2.5 Coder 32B" },
    ],
  },
  ollama: {
    id: "ollama",
    label: "Lokalny model (Ollama — prywatny, offline)",
    rank: 30,
    keysUrl: "https://ollama.com/library",
    defaultModel: "qwen3.5:4b",
    impl: askOllama,
    // Katalog pod ~4 GB VRAM (2026) z rolą i ~VRAM @ Q4. To podpowiedzi — realne modele
    // wykrywa „Odśwież modele z Ollamy" (Settings) z /api/tags. Uncensored zostają na końcu.
    models: [
      { id: "qwen3.5:4b", label: "Qwen3.5 4B — główny mózg agentowy, najlepsze tool-calling (~2.7 GB)" },
      { id: "phi4-mini", label: "Phi-4 mini — rozumowanie/analiza (~2.8 GB)" },
      { id: "gemma3:4b-it-qat", label: "Gemma 3 4B — multimodalny: lokalna wizja + 140 języków (~3 GB)" },
      { id: "llama3.2:3b", label: "Llama 3.2 3B — szybki ogólny, dobre narzędzia (~2.5 GB)" },
      { id: "qwen3:1.7b", label: "Qwen3 1.7B — refleks: voice/parsing intencji, błyskawiczny (~1.4 GB)" },
      { id: "gemma2:2b", label: "Gemma 2 2B — najszybszy na CPU, fallback (~1.7 GB)" },
      { id: "deepseek-r1:1.5b", label: "DeepSeek-R1 1.5B — łańcuch myśli/matematyka w 4 GB (~1.2 GB)" },
      { id: "qwen2.5-coder:3b", label: "Qwen2.5 Coder 3B — kod lokalnie (~2 GB)" },
      { id: "dolphin-mistral", label: "Dolphin Mistral — bez cenzury (lokalny)" },
      { id: "dolphin3", label: "Dolphin 3 — bez cenzury (lokalny)" },
      { id: "dolphin-llama3", label: "Dolphin Llama 3 — bez cenzury (lokalny)" },
      { id: "llama2-uncensored", label: "Llama 2 Uncensored (lokalny)" },
      { id: "wizard-vicuna-uncensored", label: "Wizard-Vicuna Uncensored (lokalny)" },
      { id: "nous-hermes2", label: "Nous Hermes 2 (lokalny)" },
    ],
  },
  github: {
    id: "github",
    label: "GitHub Models",
    rank: 40,
    keysUrl: "https://github.com/marketplace/models",
    defaultModel: "openai/gpt-4o-mini",
    impl: makeOpenAICompatible("https://models.github.ai/inference/chat/completions"),
    needsProxy: true,
    models: [
      { id: "openai/gpt-4o", label: "GPT-4o" },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
      { id: "meta/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B" },
      { id: "mistral-ai/Mistral-Large-2411", label: "Mistral Large" },
    ],
  },
  // Mózg on-device (WebLLM/MLC) — działa w przeglądarce/APK na WebGPU, bez serwera i bez klucza.
  // Najniższa ranga: tryb „auto" sięga po niego tylko jako lokalny ogon/awaryjnie (i w trybie prywatnym).
  webllm: {
    id: "webllm",
    label: "On-device (WebLLM — przeglądarka, WebGPU)",
    rank: 20,
    keysUrl: "https://webllm.mlc.ai",
    defaultModel: WEBLLM_DEFAULT_MODEL,
    impl: askWebllm,
    models: WEBLLM_MODELS,
  },
};

export const PROVIDER_LIST: ProviderMeta[] = Object.values(PROVIDERS);

/**
 * Pure: komunikat „odpowiedział zapasowy mózg" (albo null, gdy failoveru nie było).
 * Jedno źródło tekstu współdzielone przez czat tekstowy i wszystkie tryby głosowe —
 * bez tego każdy ekran wymyślałby własne (i rozjeżdżające się) sformułowanie.
 * NIGDY nie zgaduje przyczyny („był zajęty" itp.) — pokazuje realny, znany powód (fellBackReason,
 * np. „limit/quota", „błąd sieci", „brak klucza") albo, gdy nieznany, zostaje przy neutralnym „nie odpowiedział".
 */
/** Ludzka (ale zgodna z faktem) etykieta strukturalnej klasy powodu — gdy brak tekstu szczegółu. */
const FALLBACK_KIND_LABEL: Record<FallbackReasonKind, string> = {
  timeout: "przekroczony czas oczekiwania",
  quota: "limit zapytań/środków",
  auth: "problem z kluczem lub dostępem",
  unavailable: "chwilowo niedostępny",
  low_confidence: "lokalna odpowiedź była zbyt niepewna",
  offline: "błąd sieci",
  unknown: "",
};

type FallbackMeta = { via?: ProviderId; fellBack?: boolean; fellBackReason?: string; fellBackReasonKind?: FallbackReasonKind };

export function fallbackNotice(reply: FallbackMeta): string | null {
  if (!reply.fellBack || !reply.via) return null;
  const label = PROVIDERS[reply.via]?.label || reply.via;
  const reason = reply.fellBackReason?.trim() || (reply.fellBackReasonKind ? FALLBACK_KIND_LABEL[reply.fellBackReasonKind] : "");
  return reason
    ? `🔄 Główny mózg nie odpowiedział (${reason}) — odpowiedział zapasowy: ${label}`
    : `🔄 Główny mózg nie odpowiedział — odpowiedział zapasowy: ${label}`;
}

/**
 * Pure: krótka linia DO WYPOWIEDZENIA (bez emoji/nawiasów technicznych) — tryby głosowe,
 * w których użytkownik nie patrzy na ekran, też muszą zauważyć ważne przełączenie.
 */
export function fallbackVoiceLine(reply: FallbackMeta): string | null {
  if (!reply.fellBack || !reply.via) return null;
  const label = PROVIDERS[reply.via]?.label || reply.via;
  return `Uwaga: główny mózg nie odpowiedział — mówi zapasowy, ${label}.`;
}

/**
 * Pure: czy OGŁOSIĆ failover teraz? Rozsądny poziom natarczywości: ogłaszamy przy ZMIANIE stanu
 * (wejście w failover albo zmiana zapasowego dostawcy), nie przy każdej kolejnej odpowiedzi tego
 * samego zapasu — inaczej długa rozmowa na zapasie to seria identycznych przerywników.
 * `prevVia` = zapasowy dostawca z poprzedniej odpowiedzi (null, gdy poprzednio bez failoveru).
 */
export function shouldAnnounceFallback(prevVia: ProviderId | null, reply: FallbackMeta): boolean {
  if (!reply.fellBack || !reply.via) return false;
  return prevVia !== reply.via;
}

/** Klucze per dostawca przechowywane w ustawieniach. */
export type ProviderKeys = Record<ProviderId, string>;

export const emptyKeys: ProviderKeys = {
  anthropic: "",
  gemini: "",
  groq: "",
  cerebras: "",
  mistral: "",
  cohere: "",
  openrouter: "",
  nvidia: "",
  github: "",
  ollama: "",
  webllm: "",
};

/**
 * Tryb „auto": wybiera dostawcę z najwyższą rangą, który ma wpisany klucz.
 * Zwraca też domyślny model tego dostawcy.
 */
export function autoPick(keys: Record<string, string>): { provider: ProviderId; model: string } | null {
  const candidates = PROVIDER_LIST.filter((p) => keys[p.id]?.trim()).sort((a, b) => b.rank - a.rank);
  const best = candidates[0];
  return best ? { provider: best.id, model: best.defaultModel } : null;
}

// Modele słabo/nie filtrowane (uncensored) — chmura (OpenRouter, darmowe) i lokalne (Ollama).
// Dla nich tryb nieocenzurowany działa realnie (model nie odmawia).
export const UNCENSORED_MODELS = new Set<string>([
  "cognitivecomputations/dolphin3.0-mistral-24b:free",
  "cognitivecomputations/dolphin3.0-r1-mistral-24b:free",
  "dolphin-llama3",
  "dolphin-mistral",
  "dolphin3",
  "llama2-uncensored",
  "wizard-vicuna-uncensored",
]);

/** Czy dany model jest nieocenzurowany (chmurowy free lub lokalny). */
export const isUncensored = (model: string): boolean => UNCENSORED_MODELS.has(model);

/**
 * Pure: zwięzłe ikony cech modelu wyłuskane z jego opisu — do CZYTELNEJ listy wyboru
 * (🆓 darmowy · ⚡ szybki · 🧠 mocny · 👁 wizja · 🔓 bez cenzury). Kolejność stała, max kilka.
 * Działa na kuratorowanych etykietach z katalogu (PROVIDERS[...].models[].label).
 */
export function modelBadges(label: string): string {
  const l = (label || "").toLowerCase();
  const b: string[] = [];
  if (/darmow|free/.test(l)) b.push("🆓");
  if (/bez cenzury|uncensored|dolphin/.test(l)) b.push("🔓");
  if (/wizja|vision|pixtral|multimodaln/.test(l)) b.push("👁");
  if (/najszybsz|b[łl]yskaw|instant|\blite\b|najszyb/.test(l)) b.push("⚡");
  else if (/szybk/.test(l)) b.push("⚡");
  if (/maksymaln|najmocniejsz|najmocn|inteligencj|\bpro\b|\blarge\b|120b|70b|72b|mocne rozumowanie|bystry/.test(l)) b.push("🧠");
  return b.join("");
}

// Krótkie nazwy dostawców — przeniesione do osobnego, bezzależnościowego modułu (unikamy TDZ z cyklu
// providers↔tools↔brain w rdzeniowych komponentach). Re-eksport dla zgodności importów.
export { providerShortName } from "../providerNames";

/** Domyślny darmowy model bez cenzury w chmurze (OpenRouter). */
export const FREE_UNCENSORED = {
  provider: "openrouter" as ProviderId,
  model: "cognitivecomputations/dolphin3.0-mistral-24b:free",
};

/** Rozpoznaje dostawcę po formacie klucza (do „wklej dowolny klucz"). */
export function detectProvider(key: string): ProviderId | null {
  const k = (key || "").trim();
  if (!k) return null;
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("sk-or-")) return "openrouter"; // OpenRouter: sk-or-v1-...
  if (k.startsWith("csk-")) return "cerebras";
  if (k.startsWith("gsk_")) return "groq";
  if (k.startsWith("nvapi-")) return "nvidia";
  if (k.startsWith("AIza")) return "gemini"; // klucze Google API
  if (/^gh[posru]_/.test(k) || k.startsWith("github_pat_")) return "github";
  return null;
}
