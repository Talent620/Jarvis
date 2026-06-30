// === Doradca mózgu: „które API jest najlepsze" (czyste, testowalne) ===
// Analizuje, jakie klucze masz, i mówi WPROST: jaki dostawca+model ustawić, by było
// najmądrzej i DARMOWO — albo co dodać. Bez sieci, bez efektów ubocznych. S9-safe.

import type { ProviderId } from "./providers/types";

export interface BrainAdvice {
  action: "add_key" | "pin" | "switch" | "ok"; // co zrobić
  provider: ProviderId | null; // zalecany dostawca (null = najpierw dodaj klucz)
  model: string | null;
  message: string; // gotowy tekst do pokazania użytkownikowi
}

// Najlepsze DARMOWE mózgi w kolejności (jakość + obsługa narzędzi, której JARVIS dużo używa).
export const FREE_RANK: { id: ProviderId; model: string; label: string }[] = [
  { id: "gemini", model: "gemini-2.5-flash", label: "Google Gemini 2.5 Flash" },
  { id: "cerebras", model: "llama-3.3-70b", label: "Cerebras Llama 3.3 70B" },
  { id: "groq", model: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Groq Llama 4 Scout" },
  { id: "mistral", model: "mistral-small-latest", label: "Mistral Small" },
  { id: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", label: "OpenRouter Llama 3.3 70B (free)" },
];

const TOP_FREE = FREE_RANK[0]; // Gemini — najlepszy darmowy, #1 w narzędziach

/**
 * Pure: doradź najlepszy darmowy mózg dla danego stanu ustawień.
 * @param hasKey funkcja: czy jest klucz do dostawcy
 */
export function recommendBrain(
  hasKey: (id: ProviderId) => boolean,
  provider: string,
  model: string,
): BrainAdvice {
  const availableFree = FREE_RANK.filter((p) => hasKey(p.id));
  const best = availableFree[0] || null;

  // 1) Brak jakiegokolwiek darmowego klucza → poradź dodać darmowy Gemini.
  if (!best) {
    return {
      action: "add_key",
      provider: null,
      model: null,
      message: `Najlepszy DARMOWY mózg to ${TOP_FREE.label} (#1 w obsłudze narzędzi, a JARVIS to agent). Dodaj darmowy klucz: aistudio.google.com → ⚙ → AI. Potem powiedz „ustaw stały umysł i głos".`,
    };
  }

  const hasTopFree = hasKey(TOP_FREE.id);
  const pinnedToBest = provider === best.id && model === best.model;

  // 2) Masz NAJLEPSZY darmowy (Gemini) i jest przypięty na stałe → idealnie.
  if (best.id === TOP_FREE.id && pinnedToBest) {
    return { action: "ok", provider: best.id, model: best.model, message: `Masz już najlepszy darmowy mózg ustawiony na stałe: ${best.label}. Nic nie trzeba zmieniać.` };
  }

  // 3) Masz Gemini, ale nie jest ustawiony (auto albo inny dostawca) → przypnij/przełącz na Gemini.
  if (hasTopFree && !(provider === TOP_FREE.id && model === TOP_FREE.model)) {
    return {
      action: provider === "auto" ? "pin" : "switch",
      provider: TOP_FREE.id,
      model: TOP_FREE.model,
      message: `${provider === "auto" ? "Masz tryb auto (mózg zmienia się co wiadomość). " : ""}Najlepszy darmowy, który masz, to ${TOP_FREE.label}. Ustawić go NA STAŁE? Powiedz „ustaw stały umysł i głos".`,
    };
  }

  // 4) NIE masz Gemini — najlepszy z dostępnych to `best`. OK jeśli przypięty, ale i tak zachęć do Gemini.
  return {
    action: pinnedToBest ? "ok" : "pin",
    provider: best.id,
    model: best.model,
    message: `Twój najlepszy dostępny darmowy mózg to ${best.label}${pinnedToBest ? " — ustawiony na stałe, OK" : ` (powiedz „ustaw stały umysł i głos", by go przypiąć)`}. Dla jeszcze lepszej jakości dodaj darmowy ${TOP_FREE.label} (aistudio.google.com).`,
  };
}
