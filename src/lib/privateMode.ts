import { Capacitor } from "@capacitor/core";
import { store } from "./store";
import { fetchTimeout } from "./http";
import { webllmSupported, WEBLLM_DEFAULT_MODEL } from "./webllm";

// Tryb Prywatny — JARVIS działa w 100% lokalnie (Ollama na Twoim sprzęcie):
// żadne dane nie wychodzą do chmury, brak polityki dostawcy. To autentyczny,
// prywatny asystent bez limitów zewnętrznych usług.

const DEFAULT_OLLAMA = "http://localhost:11434";

/**
 * Doprowadź adres Ollamy wpisany przez użytkownika do działającej formy. Czysta (testowalna).
 * Obsługuje typowe pomyłki: brak schematu („100.64.33.7:11434" → „http://…"), wklejone spacje,
 * końcowy ukośnik, a przy gołym adresie http bez portu dokłada domyślny port Ollamy 11434
 * („http://100.64.33.7" → „…:11434"). Dla https (np. Tailscale serve) NIE rusza portu.
 */
export function normalizeOllamaUrl(raw?: string): string {
  let u = (raw || "").replace(/\s+/g, "");
  if (!u) return DEFAULT_OLLAMA;
  if (!/^https?:\/\//i.test(u)) u = "http://" + u; // brak schematu → lokalny serwer po http
  u = u.replace(/\/+$/, ""); // bez końcowych ukośników
  try {
    const p = new URL(u);
    const noPath = p.pathname.replace(/^\/+/, "") === "";
    if (p.protocol === "http:" && !p.port && noPath && !p.hostname.includes(":")) {
      p.port = "11434"; // typowy adres Ollamy bez portu → domyślny 11434
      u = p.toString().replace(/\/+$/, "");
    }
  } catch {
    /* niepoprawny URL — zostaw po prostej normalizacji, detekcja i tak zwróci czytelny błąd */
  }
  return u;
}

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
export type OllamaPlatform = "linux" | "windows" | "mac" | "android" | "ios" | "web";

function ollamaPlatform(): OllamaPlatform {
  try {
    const native = Capacitor.getPlatform?.();
    if (native === "android" || native === "ios") return native;
    const desktop = (window as unknown as { jarvisDesktop?: { platform?: string } }).jarvisDesktop?.platform;
    if (desktop === "linux") return "linux";
    if (desktop === "win32") return "windows";
    if (desktop === "darwin") return "mac";
  } catch { /* no desktop or native bridge */ }
  return "web";
}

export function diagnoseOllamaError(url: string, err: unknown, pageHttps: boolean, isNative = false, platform: OllamaPlatform = ollamaPlatform()): string {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  const isHttpUrl = /^http:\/\//i.test(url);
  let loopback = false;
  try { loopback = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname); } catch { /* invalid address */ }
  // Mixed-content (HTTPS-strona ↔ HTTP-serwer) blokuje TYLKO przeglądarka. W aplikacji (APK)
  // cleartext do sieci lokalnej i Tailscale jest dozwolony (network security config), więc tej
  // diagnozy tam NIE pokazujemy — błąd ma inną przyczynę (serwer, adres, CORS) niżej.
  if (pageHttps && isHttpUrl && !loopback && !isNative) {
    return "Przeglądarka blokuje HTTP ze strony HTTPS. Sprawdź bezpieczne połączenie z serwerem.";
  }
  if (name === "AbortError" || /abort|timeout|timed out/i.test(msg)) {
    return "Ollama nie odpowiedziała w czasie. Sprawdź usługę i adres serwera.";
  }
  if (/failed to fetch|load failed|networkerror|fetch|connection/i.test(msg)) {
    if (platform === "android" || platform === "ios") return "Nie mogę połączyć się z Ollamą. Sprawdź adres komputera i połączenie sieciowe.";
    if (loopback && platform === "linux") return "Nie mogę połączyć się z Ollamą. Uruchom ją na Linuksie i sprawdź localhost:11434.";
    if (loopback && platform === "windows") return "Nie mogę połączyć się z Ollamą. Uruchom ją na Windows i sprawdź localhost:11434.";
    if (loopback && platform === "mac") return "Nie mogę połączyć się z Ollamą. Uruchom ją na Macu i sprawdź localhost:11434.";
    return "Nie mogę połączyć się z Ollamą. Sprawdź usługę i adres serwera.";
  }
  return msg || "Nieznany błąd połączenia z Ollamą.";
}

/** Sprawdza, czy lokalny serwer Ollama działa i jakie modele są pobrane. */
export async function detectOllama(rawUrl?: string): Promise<OllamaStatus> {
  const url = normalizeOllamaUrl(rawUrl || store.settings.ollamaUrl);
  try {
    const res = await fetchTimeout(`${url}/api/tags`, { method: "GET" }, 8000);
    if (!res.ok) {
      const hint = res.status === 403 ? " (sprawdź uprawnienia i ustawienia połączenia)" : "";
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
  const list = Array.from(new Set(raw.filter((u): u is string => !!u && !!u.trim()).map((u) => normalizeOllamaUrl(u))));
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
    error: "Nie znaleziono Ollamy. Uruchom usługę i sprawdź adres serwera w ustawieniach.",
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
