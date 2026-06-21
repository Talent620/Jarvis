// Krótkie, ludzkie nazwy dostawców — WYDZIELONE do modułu BEZ zależności, by rdzeniowe komponenty
// (np. Conversation) mogły z nich korzystać bez wciągania cyklu providers↔tools↔brain (TDZ przy
// niekorzystnej kolejności ładowania bundla). Czyste, samowystarczalne.
const PROVIDER_SHORT: Record<string, string> = {
  anthropic: "Claude", gemini: "Gemini", groq: "Groq", cerebras: "Cerebras", mistral: "Mistral",
  cohere: "Cohere", openrouter: "OpenRouter", nvidia: "NVIDIA", github: "GitHub Models",
  ollama: "lokalny (Ollama)", webllm: "lokalny (przeglądarka)",
};

/** Pure: krótka nazwa dostawcy (do etykiety „via …" pod odpowiedzią). Pusty wkład → "". */
export function providerShortName(id?: string): string {
  return id ? (PROVIDER_SHORT[id] || id) : "";
}
