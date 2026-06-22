// === 🆓 Tryb darmowy — JARVIS bez płatnego API (prawie ta sama klasa, 0 zł) ===
// Wymusza, by mózg działał WYŁĄCZNIE na dostawcach z darmowym tierem (Gemini, Groq,
// Cerebras, Mistral, Cohere, OpenRouter:free — w tym DeepSeek V3, NVIDIA) oraz lokalnie
// (Ollama/WebLLM). Płatny Claude (Anthropic) jest pomijany. Auto-router + Liga i tak
// wybiorą najmocniejszy dostępny darmowy model, więc jakość zostaje wysoka.
import type { ProviderId } from "./providers/types";

// Dostawcy z realnym darmowym tierem (lub w pełni lokalni).
export const FREE_PROVIDERS = new Set<ProviderId>([
  "gemini", "groq", "cerebras", "mistral", "cohere", "openrouter", "nvidia", "ollama", "webllm",
]);

export const isFreeProvider = (id: ProviderId): boolean => FREE_PROVIDERS.has(id);

/** Odfiltruj łańcuch dostawców do samych darmowych (zachowuje kolejność). */
export function freeOnly<T extends { provider: ProviderId }>(order: T[]): T[] {
  return order.filter((o) => isFreeProvider(o.provider));
}

// Rekomendowany darmowy zestaw — kolejność wg jakości/niezawodności dla JARVISA.
// (Pierwszy z kluczem zadziała jako główny; reszta to automatyczny failover.)
export const FREE_STACK: { provider: ProviderId; why: string }[] = [
  { provider: "gemini", why: "Gemini 2.5 Flash — #1 tool-calling, hojny darmowy limit (klucz: aistudio.google.com)" },
  { provider: "groq", why: "Groq (Kimi K2) — mocne rozumowanie, błyskawiczny (klucz: console.groq.com)" },
  { provider: "openrouter", why: "OpenRouter — darmowy DeepSeek V3 / Llama 405B (klucz: openrouter.ai)" },
  { provider: "cerebras", why: "Cerebras — ~2000 tok/s, darmowy (klucz: cloud.cerebras.ai)" },
  { provider: "mistral", why: "Mistral — szeroki darmowy tier, wizja (klucz: console.mistral.ai)" },
];
