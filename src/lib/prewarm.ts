// Prewarm (Zadanie 13) — antycypacja: trzymamy model lokalny gorący w VRAM, by ciąć cold-start.
// To UX latencji, nie magia: keep-alive (Z4) utrzymuje model po pierwszej turze, a prewarm
// WYPRZEDZA pierwszą turę — po focusie aplikacji / po zakończeniu rozmowy ładuje model z góry.
// Opt-in (prewarmLocal), throttlowany, fire-and-forget (błąd nic nie psuje).

import { store } from "./store";
import { fetchTimeout } from "./http";
import { PROVIDERS } from "./providers/registry";

let lastPrewarm = 0;
const THROTTLE_MS = 60_000; // nie częściej niż raz na minutę

/** Czy warto teraz rozgrzać: opt-in + jest adres Ollamy + nie za często. Czysta decyzja. */
export function shouldPrewarm(now = Date.now()): boolean {
  const s = store.settings;
  if (!s.prewarmLocal || !s.ollamaUrl?.trim()) return false;
  return now - lastPrewarm >= THROTTLE_MS;
}

/** Model do rozgrzania: wybrany ręcznie > nadpisanie modelu „prostego" (najczęstsza szybka tura) > domyślny. */
export function prewarmModel(): string {
  const s = store.settings;
  if (s.provider === "ollama" && s.model && s.model !== "auto") return s.model;
  return s.ollamaModelSimple?.trim() || PROVIDERS.ollama.defaultModel;
}

/**
 * Rozgrzej model lokalny, jeśli trzeba. `POST /api/generate` BEZ promptu tylko ładuje model do
 * VRAM (Ollama nie generuje) + keep_alive trzyma go ciepłym. Zwraca true, gdy ping poszedł.
 */
export async function maybePrewarm(now = Date.now()): Promise<boolean> {
  if (!shouldPrewarm(now)) return false;
  lastPrewarm = now; // ustaw od razu (anty-burst), niezależnie od wyniku
  const base = store.settings.ollamaUrl!.trim().replace(/\/$/, "");
  try {
    await fetchTimeout(
      `${base}/api/generate`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: prewarmModel(), keep_alive: "30m" }) },
      8000,
    );
    return true;
  } catch {
    return false; // serwer nieosiągalny — trudno, to tylko rozgrzewka
  }
}

/** Tylko do testów — wyzeruj throttle. */
export function __resetPrewarm(): void {
  lastPrewarm = 0;
}
