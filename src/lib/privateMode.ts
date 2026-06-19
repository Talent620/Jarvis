import { store } from "./store";
import { fetchTimeout } from "./http";
import { webllmSupported, WEBLLM_DEFAULT_MODEL } from "./webllm";

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
    // PWA/APK bez Ollamy: jeśli przeglądarka ma WebGPU, włącz mózg on-device (WebLLM) —
    // model działa w przeglądarce, bez serwera. To rozszerza Tryb Prywatny poza desktop.
    if (webllmSupported()) {
      const model = store.settings.webllmModel?.trim() || WEBLLM_DEFAULT_MODEL;
      store.setSettings({ provider: "webllm", model, webllmEnabled: true });
      return {
        enabled: true,
        message:
          `🛡 Tryb Prywatny aktywny (on-device, WebLLM). Model „${model}" działa w Twojej przeglądarce na WebGPU — rozmowy z AI nie idą do zewnętrznego dostawcy. ` +
          "Pierwsze użycie pobiera wagi modelu (jednorazowo, potem cache). Dla twardej blokady chmury włącz dodatkowo Tryb on-device w ⚙ → AI.",
      };
    }
    return {
      enabled: false,
      message:
        "Tryb Prywatny wymaga lokalnego serwera Ollama LUB przeglądarki z WebGPU (mózg on-device WebLLM). " +
        "Na desktopie: zainstaluj Ollamę z ollama.com, pobierz model komendą  ollama pull dolphin-mistral  (domyślnie http://localhost:11434, adres w ⚙ → AI). " +
        "Na telefonie/PWA: użyj przeglądarki ze wsparciem WebGPU.",
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
      `🛡 Tryb Prywatny aktywny. Model „${model}" działa lokalnie (Ollama) — rozmowy z AI nie idą do zewnętrznego dostawcy. Uwaga: pojedyncze funkcje pomocnicze (np. pogoda) mogą nadal korzystać z sieci.` +
      (uncensored
        ? " Model jest nieocenzurowany: odpowiadam wprost, bez ograniczeń zewnętrznych usług."
        : " Wskazówka: dla pełnego braku ograniczeń pobierz model bez cenzury:  ollama pull dolphin-mistral."),
  };
}
