import { store } from "./store";
import { fetchTimeout } from "./http";

// Tryb Prywatny — JARVIS działa w 100% lokalnie (Ollama na Twoim sprzęcie):
// żadne dane nie wychodzą do chmury, brak polityki dostawcy. To autentyczny,
// prywatny asystent bez limitów zewnętrznych usług.

const DEFAULT_OLLAMA = "http://localhost:11434";

// Modele bez cenzury preferowane przy autostarcie (jeśli pobrane lokalnie).
const PREFERRED = ["dolphin-mistral", "dolphin3", "dolphin-llama3", "llama2-uncensored", "wizard-vicuna-uncensored"];

export interface OllamaStatus {
  ok: boolean;
  url: string;
  models: string[];
  error?: string;
}

/** Sprawdza, czy lokalny serwer Ollama działa i jakie modele są pobrane. */
export async function detectOllama(rawUrl?: string): Promise<OllamaStatus> {
  const url = (rawUrl || store.settings.ollamaUrl || DEFAULT_OLLAMA).replace(/\/$/, "");
  try {
    const res = await fetchTimeout(`${url}/api/tags`, { method: "GET" }, 8000);
    if (!res.ok) return { ok: false, url, models: [], error: `Serwer odpowiedział ${res.status}.` };
    const d = await res.json();
    const models = (d?.models || []).map((m: any) => String(m.name || m.model)).filter(Boolean);
    return { ok: true, url, models };
  } catch (e) {
    return { ok: false, url, models: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Wybiera najlepszy lokalny model (preferuje uncensored, potem cokolwiek). */
export function pickLocalModel(models: string[]): string | null {
  const base = (m: string) => m.split(":")[0].toLowerCase();
  for (const p of PREFERRED) {
    const hit = models.find((m) => base(m).includes(p));
    if (hit) return hit;
  }
  return models[0] || null;
}

export interface PrivateResult {
  enabled: boolean;
  message: string;
}

/**
 * Włącza Tryb Prywatny: ustawia dostawcę na lokalny model i wyłącza zewnętrzne
 * ograniczenia. Zwraca jasny komunikat o stanie (i instrukcję, gdy brak Ollamy).
 */
export async function enablePrivateMode(rawUrl?: string): Promise<PrivateResult> {
  const status = await detectOllama(rawUrl);
  if (!status.ok) {
    return {
      enabled: false,
      message:
        "Tryb Prywatny wymaga lokalnego serwera Ollama. Zainstaluj go z ollama.com, pobierz model bez cenzury komendą  ollama pull dolphin-mistral, i upewnij się, że działa (domyślnie http://localhost:11434). Adres ustawisz w ⚙ → AI.",
    };
  }
  if (!status.models.length) {
    return {
      enabled: false,
      message:
        "Ollama działa, ale nie ma pobranego żadnego modelu. W terminalu uruchom:  ollama pull dolphin-mistral  (model bez cenzury), potem włącz Tryb Prywatny ponownie.",
    };
  }
  const model = pickLocalModel(status.models)!;
  store.setSettings({
    provider: "ollama",
    model,
    ollamaUrl: status.url,
    unfilteredLocal: true,
  });
  const uncensored = /dolphin|uncensored|wizard-vicuna/i.test(model);
  return {
    enabled: true,
    message:
      `🛡 Tryb Prywatny aktywny. Działam w 100% lokalnie na modelu „${model}" — żadne dane nie opuszczają tego urządzenia, brak polityki dostawcy.` +
      (uncensored
        ? " Model jest nieocenzurowany: odpowiadam wprost, bez ograniczeń zewnętrznych usług."
        : " Wskazówka: dla pełnego braku ograniczeń pobierz model bez cenzury:  ollama pull dolphin-mistral."),
  };
}
