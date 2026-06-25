import { Capacitor } from "@capacitor/core";
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

/**
 * Zamień surowy błąd fetch („Failed to fetch") na DZIAŁAJĄCĄ diagnozę: nazwij prawdopodobną
 * przyczynę (mixed-content / timeout / CORS-lub-nieosiągalny) i podaj konkretną naprawę. Czysta.
 */
export function diagnoseOllamaError(url: string, err: unknown, pageHttps: boolean, isNative = false): string {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  const isHttpUrl = /^http:\/\//i.test(url);
  // Mixed-content (HTTPS-strona ↔ HTTP-serwer) blokuje TYLKO przeglądarka. W aplikacji (APK)
  // cleartext do sieci lokalnej i Tailscale jest dozwolony (network security config), więc tej
  // diagnozy tam NIE pokazujemy — błąd ma inną przyczynę (serwer, adres, CORS) niżej.
  if (pageHttps && isHttpUrl && !isNative) {
    return "Mieszana zawartość: w przeglądarce aplikacja działa po HTTPS, a adres Ollamy jest http:// — przeglądarka to blokuje. Zainstaluj APK (dopuszcza HTTP do sieci domowej i Tailscale 100.64.x.x) albo wystaw Ollamę po HTTPS.";
  }
  if (name === "AbortError" || /abort|timeout|timed out/i.test(msg)) {
    return "Serwer Ollama nie odpowiedział w czasie. Sprawdź, czy działa, czy adres jest poprawny i czy PC oraz telefon są w tej samej sieci (lub przez Tailscale).";
  }
  if (/failed to fetch|load failed|networkerror|fetch|connection/i.test(msg)) {
    return "Nie udało się połączyć z Ollamą (\"failed to fetch\"). Najczęstsze przyczyny: (1) CORS — ustaw OLLAMA_ORIGINS=* i OLLAMA_HOST=0.0.0.0 i zrestartuj Ollamę; (2) zły adres lub inna sieć; (3) serwer nie działa. Najprościej: uruchom na PC plik JARVIS-Ollama-Server.exe — ustawia to wszystko sam.";
  }
  return msg || "Nieznany błąd połączenia z Ollamą.";
}

/** Sprawdza, czy lokalny serwer Ollama działa i jakie modele są pobrane. */
export async function detectOllama(rawUrl?: string): Promise<OllamaStatus> {
  const url = (rawUrl || store.settings.ollamaUrl || DEFAULT_OLLAMA).replace(/\/$/, "");
  try {
    const res = await fetchTimeout(`${url}/api/tags`, { method: "GET" }, 8000);
    if (!res.ok) {
      const hint = res.status === 403 ? " (prawdopodobnie CORS — ustaw OLLAMA_ORIGINS=*)" : "";
      return { ok: false, url, models: [], error: `Serwer odpowiedział ${res.status}${hint}.` };
    }
    const d = await res.json();
    const models = (d?.models || []).map((m: any) => String(m.name || m.model)).filter(Boolean);
    return { ok: true, url, models };
  } catch (e) {
    const pageHttps = typeof location !== "undefined" && location.protocol === "https:";
    let native = false;
    try { native = Capacitor.isNativePlatform?.() === true; } catch { /* web */ }
    return { ok: false, url, models: [], error: diagnoseOllamaError(url, e, pageHttps, native) };
  }
}

/**
 * Auto-znajdź działający serwer Ollama: próbuje kolejno kandydatów (obecny adres, localhost,
 * 127.0.0.1) i zwraca pierwszy, który odpowiada — żeby użytkownik nie musiał wpisywać adresu.
 * Na PC localhost trafia od ręki; dla telefonu poda się adres LAN/Tailscale osobno.
 */
export async function findOllamaServer(candidates?: string[]): Promise<OllamaStatus & { tried: string[] }> {
  const cur = store.settings.ollamaUrl?.trim();
  const raw = candidates ?? [cur, "http://localhost:11434", "http://127.0.0.1:11434"];
  const list = Array.from(new Set(raw.filter((u): u is string => !!u && !!u.trim()).map((u) => u.trim())));
  const tried: string[] = [];
  for (const url of list) {
    tried.push(url);
    const r = await detectOllama(url);
    if (r.ok) return { ...r, tried };
  }
  return {
    ok: false,
    url: list[0] || "",
    models: [],
    error: `Nie znalazłem serwera Ollama (próbowałem: ${tried.join(", ") || "localhost"}). Na PC uruchom JARVIS-Ollama-Server.exe; na telefonie włącz Tailscale (to samo konto) i podaj adres PC, NIE localhost.`,
    tried,
  };
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
