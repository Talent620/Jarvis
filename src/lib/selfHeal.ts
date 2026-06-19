// === „Uruchom i napraw" — samonaprawa, żeby JARVIS ZAWSZE odpowiadał ===
// Jeden ruch: stosuje bezpieczne poprawki ustawień, wykrywa/sprawdza serwer Ollama, AUTONOMICZNIE
// wybiera dostawcę+model, który faktycznie odpowie, rozgrzewa model i zwraca czytelny status.
import { store } from "./store";
import { settingsFixes } from "./healthCheck";
import { detectOllama, findOllamaServer } from "./privateMode";
import { warmNow } from "./prewarm";
import { isDesktop } from "./desktop";
import { PROVIDER_LIST } from "./providers/registry";

export interface BrainPick { provider: string; model: string }

/**
 * Wybierz dostawcę+model, który ZADZIAŁA — czysta, testowalna.
 * Zasada: jeśli obecny wybór da się obsłużyć, zostaw go (popraw tylko zły model Ollamy);
 * w przeciwnym razie weź cokolwiek działa: Ollama (lokalnie) > auto (chmura z kluczem).
 */
export function pickWorkingBrain(opts: {
  current: BrainPick;
  ollamaOk: boolean;
  installedModels: string[];
  cloudKeyProviders: string[];
}): BrainPick | null {
  const { current, ollamaOk, installedModels, cloudKeyProviders } = opts;
  const hasCloud = cloudKeyProviders.length > 0;

  // Czy obecny wybór jest obsługiwalny?
  if (current.provider === "ollama" && ollamaOk) {
    const model = current.model && current.model !== "auto" && installedModels.includes(current.model) ? current.model : "auto";
    return { provider: "ollama", model };
  }
  if (current.provider === "auto" && (ollamaOk || hasCloud)) return { provider: "auto", model: "auto" };
  if (current.provider !== "auto" && current.provider !== "ollama" && cloudKeyProviders.includes(current.provider)) {
    return current; // ręczny dostawca chmurowy z kluczem — zostaje
  }

  // Obecny nie zadziała → autonomicznie bierzemy to, co działa.
  if (ollamaOk) return { provider: "ollama", model: "auto" };
  if (hasCloud) return { provider: "auto", model: "auto" };
  return null; // nic nie skonfigurowane
}

export interface HealResult {
  ok: boolean;
  steps: string[];
  brain: string | null; // wybrany dostawca (etykieta) albo null
  summary: string;
}

/** Uruchom i napraw: bezpieczne poprawki + wykrycie serwera + wybór działającego mózgu + rozgrzewka. */
export async function runAndFix(onStep?: (msg: string) => void): Promise<HealResult> {
  const steps: string[] = [];
  const note = (m: string) => { steps.push(m); onStep?.(m); };

  // 1) Bezpieczne, deterministyczne poprawki ustawień (zły dostawca → auto, brudny adres, zły model…).
  for (const f of settingsFixes()) {
    if (f.fix) { f.fix.apply(); note(`✓ ${f.fix.label}`); }
  }

  // 2) Serwer Ollama: na desktopie bez adresu — znajdź (localhost); z adresem — sprawdź.
  let ollamaOk = false;
  let installed: string[] = [];
  const url = store.settings.ollamaUrl?.trim();
  if (!url && isDesktop()) {
    note("Szukam lokalnego serwera Ollama…");
    const r = await findOllamaServer(["http://localhost:11434", "http://127.0.0.1:11434"]);
    if (r.ok) { store.setSettings({ ollamaUrl: r.url }); ollamaOk = true; installed = r.models; note(`✓ Znaleziono serwer Ollama (${r.url})`); }
  } else if (url) {
    note("Sprawdzam serwer Ollama…");
    const d = await detectOllama(url);
    ollamaOk = d.ok; installed = d.models;
    note(ollamaOk ? `✓ Serwer Ollama działa (${installed.length} model(i))` : "• Ollama nieosiągalna — spróbuję chmury");
  }

  // 3) Autonomiczny wybór mózgu, który odpowie.
  const cloudKeyProviders = PROVIDER_LIST.filter((p) => p.id !== "ollama" && store.settings.keys[p.id]?.trim()).map((p) => p.id);
  const pick = pickWorkingBrain({
    current: { provider: store.settings.provider, model: store.settings.model },
    ollamaOk,
    installedModels: installed,
    cloudKeyProviders,
  });
  if (pick && (pick.provider !== store.settings.provider || pick.model !== store.settings.model)) {
    store.setSettings({ provider: pick.provider, model: pick.model });
    note(`✓ Ustawiłem mózg: ${pick.provider} / ${pick.model}`);
  }

  // 4) Rozgrzej model lokalny — pierwsza odpowiedź od ręki.
  if (ollamaOk) void warmNow();

  const brainLabel = pick ? (PROVIDER_LIST.find((p) => p.id === pick.provider)?.label || pick.provider) : null;
  const ok = !!pick;
  const summary = ok
    ? `✅ Wszystko gotowe. Mózg: ${pick!.provider === "auto" ? "auto (chmura)" : brainLabel}. JARVIS odpowie.`
    : "⚠ Brak działającego mózgu: uruchom serwer Ollama (JARVIS-Ollama-Server.exe) albo wpisz klucz API w ⚙ → AI.";
  return { ok, steps, brain: brainLabel, summary };
}
