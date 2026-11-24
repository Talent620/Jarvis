// === Sprint 2 / Moduł 4a: Live Vision („Oczy w terenie” / „Pokaż Jarvisowi”) ===
// Jedno kliknięcie lub komenda głosowa „popatrz na to”:
// 1) robi skompresowaną klatkę z tylnej kamery,
// 2) wysyła ją razem z pytaniem głosowym do modelu multimodalnego w trybie voice_mode,
// 3) zwraca krótką, praktyczną instrukcję głosową bez konieczności patrzenia w ekran.
import { askJarvis } from "./brain";
import { captureRearCameraFrame, type CapturedImage } from "./camera";
import { formatForSpokenPolish } from "./soulModes";
import type { JarvisReply, Msg } from "./providers/types";

export const DEFAULT_LIVE_VISION_QUESTION =
  "Popatrz na to zdjęcie. Powiedz krótko co widzisz i daj mi konkretną wskazówkę, co mam teraz zrobić.";

export const LIVE_VISION_SYSTEM_PROMPT = [
  "TRYB LIVE VISION („OCZY W TERENIE” — BEZEKRANOWO):",
  "- Użytkownik pokazuje Ci świat przez tylną kamerę i NIE patrzy na ekran telefonu.",
  "- Odpowiedz w MAKSYMALNIE 2–3 krótkich, naturalnych zdaniach po polsku pod odsłuch głosowy.",
  "- Najpierw nazwij kluczowy obiekt/problem/etykietę lub usterkę, potem daj jedną konkretną instrukcję krok po kroku.",
  "- ZERO list punktowanych, ZERO markdowna, ZERO URL-i.",
].join("\n");

const LIVE_VISION_RE =
  /^(?:jarvis[, ]+)?(?:popatrz na to|sp[óo]jrz na to|zobacz na to|zobacz to|poka[żz] jarvisowi|oczy w terenie)(?:[,:\s—-]+(.*))?$/i;

/** Pure: rozpoznaj komendę głosową „popatrz na to [pytanie]”. */
export function parseLiveVisionCommand(text: string): { matched: boolean; question: string } {
  const m = LIVE_VISION_RE.exec((text || "").trim());
  if (!m) return { matched: false, question: "" };
  const tail = (m[1] || "").trim();
  return {
    matched: true,
    question: tail.length >= 3 ? tail : DEFAULT_LIVE_VISION_QUESTION,
  };
}

export interface LiveVisionResult {
  question: string;
  image: CapturedImage;
  text: string;
  spokenText: string;
  via?: JarvisReply["via"];
}

export type LiveVisionAsker = (history: Msg[], extraSystem: string) => Promise<JarvisReply>;

const defaultAsker: LiveVisionAsker = (history, extraSystem) =>
  askJarvis(history, undefined, undefined, extraSystem, undefined, { voiceMode: true });

/**
 * Uruchom tryb „Pokaż Jarvisowi”: przechwyć skompresowaną klatkę z tylnej kamery
 * i przeanalizuj ją multimodalnie pod krótką instrukcję głosową.
 */
export async function runLiveVision(
  question?: string,
  opts: { capture?: () => Promise<CapturedImage | null>; ask?: LiveVisionAsker } = {},
): Promise<LiveVisionResult | null> {
  const capture = opts.capture || captureRearCameraFrame;
  const ask = opts.ask || defaultAsker;

  const image = await capture();
  if (!image) return null;

  const q = (question || "").trim() || DEFAULT_LIVE_VISION_QUESTION;
  const reply = await ask(
    [{ role: "user", content: q, image }],
    LIVE_VISION_SYSTEM_PROMPT,
  );
  const text = (reply.text || "").trim() || "Nie udało się odczytać szczegółów ze zdjęcia — spróbuj podejść bliżej.";
  const spokenText = formatForSpokenPolish(text, 3) || text;
  return { question: q, image, text, spokenText, via: reply.via };
}
