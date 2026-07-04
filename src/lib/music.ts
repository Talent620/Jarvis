import { isDesktop, mediaPc, volumePc } from "./desktop";
import { openService } from "./deviceControl";

// Sterowanie muzyką z „Trybu Słuchawki". Na komputerze (Electron) pełne klawisze
// multimedialne; na telefonie — otwarcie/zmiana przez odtwarzacz (Spotify) lub głos.
export type MusicAction = "playpause" | "next" | "prev" | "volup" | "voldown";

export async function musicCommand(action: MusicAction): Promise<string> {
  if (isDesktop()) {
    if (action === "volup") return volumePc("up");
    if (action === "voldown") return volumePc("down");
    return mediaPc(action);
  }
  // Telefon: pełne sterowanie cudzym odtwarzaczem z aplikacji webowej jest
  // ograniczone — najlepiej działa przez głos (agent zrobi to narzędziami).
  return "Na telefonie powiedz np. następna piosenka albo puść danego wykonawcę — zajmę się tym.";
}

/** Otwórz muzykę (np. „puść jazz" → Spotify). */
export async function playMusic(query?: string): Promise<string> {
  return openService("spotify", query);
}
