import { askAnthropic } from "./anthropic";
import { makeOpenAICompatible } from "./openai";
import { askGemini } from "./gemini";
import { store } from "../store";
import type { AskCtx, ProviderId, ProviderMeta } from "./types";

// Lokalny model (Ollama) — endpoint z ustawień, bez klucza, pełna prywatność.
function askOllama(ctx: AskCtx) {
  const base = (store.settings.ollamaUrl || "http://localhost:11434").replace(/\/$/, "");
  return makeOpenAICompatible(`${base}/v1/chat/completions`)(ctx);
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
    defaultModel: "llama-3.3-70b-versatile",
    impl: makeOpenAICompatible("https://api.groq.com/openai/v1/chat/completions"),
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B — darmowy" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B — najszybszy" },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
      { id: "qwen/qwen3-32b", label: "Qwen3 32B" },
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
    keysUrl: "https://ollama.com",
    defaultModel: "llama3.2",
    impl: askOllama,
    models: [
      { id: "llama3.2", label: "Llama 3.2 (lokalny)" },
      { id: "qwen2.5", label: "Qwen2.5 (lokalny)" },
      { id: "llama3.1", label: "Llama 3.1 (lokalny)" },
      { id: "mistral", label: "Mistral (lokalny)" },
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
};

export const PROVIDER_LIST: ProviderMeta[] = Object.values(PROVIDERS);

/** Klucze per dostawca przechowywane w ustawieniach. */
export type ProviderKeys = Record<ProviderId, string>;

export const emptyKeys: ProviderKeys = {
  anthropic: "",
  gemini: "",
  groq: "",
  openrouter: "",
  nvidia: "",
  github: "",
  ollama: "",
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

/** Rozpoznaje dostawcę po formacie klucza (do „wklej dowolny klucz"). */
export function detectProvider(key: string): ProviderId | null {
  const k = (key || "").trim();
  if (!k) return null;
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("sk-or-")) return "openrouter"; // OpenRouter: sk-or-v1-...
  if (k.startsWith("gsk_")) return "groq";
  if (k.startsWith("nvapi-")) return "nvidia";
  if (k.startsWith("AIza")) return "gemini"; // klucze Google API
  if (/^gh[posru]_/.test(k) || k.startsWith("github_pat_")) return "github";
  return null;
}
