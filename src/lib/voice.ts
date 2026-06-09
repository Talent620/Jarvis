import type { Settings } from "../types";
import { Capacitor, registerPlugin } from "@capacitor/core";

// Natywny silnik mowy Androida (pewniejszy niż Web Speech w WebView).
interface NativeTtsPlugin {
  speak(o: { text: string; pitch: number; rate: number; lang: string }): Promise<void>;
  stop(): Promise<void>;
}
const NativeTTS = registerPlugin<NativeTtsPlugin>("NativeTTS");

// --- Synteza mowy (TTS) ---

let cachedVoices: SpeechSynthesisVoice[] = [];

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const got = synth?.getVoices() ?? [];
    if (got.length) {
      cachedVoices = got;
      resolve(got);
      return;
    }
    if (!synth) {
      resolve([]);
      return;
    }
    synth.onvoiceschanged = () => {
      cachedVoices = synth.getVoices();
      resolve(cachedVoices);
    };
    // Fallback, gdyby zdarzenie nie wystąpiło.
    setTimeout(() => resolve(cachedVoices.length ? cachedVoices : synth.getVoices()), 500);
  });
}

// Heurystyka wyboru najbardziej „JARVIS-owego” głosu: brytyjski, męski.
const JARVIS_HINTS = ["daniel", "george", "ryan", "arthur", "uk english male", "google uk english male"];

function pickVoice(settings: Settings): SpeechSynthesisVoice | undefined {
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis?.getVoices() ?? [];
  if (!voices.length) return undefined;
  if (settings.voiceName) {
    const exact = voices.find((v) => v.name === settings.voiceName);
    if (exact) return exact;
  }
  for (const hint of JARVIS_HINTS) {
    const v = voices.find((x) => x.name.toLowerCase().includes(hint));
    if (v) return v;
  }
  // Preferuj angielski (brzmi bardziej jak oryginał), inaczej pierwszy dostępny.
  return voices.find((v) => v.lang.toLowerCase().startsWith("en")) || voices[0];
}

let currentAudio: HTMLAudioElement | null = null;

async function playFromResponse(res: Response): Promise<boolean> {
  if (!res.ok) return false;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  currentAudio = new Audio(url);
  currentAudio.onended = () => URL.revokeObjectURL(url);
  await currentAudio.play();
  return true;
}

export async function speak(text: string, settings: Settings): Promise<void> {
  if (!settings.speak || !text.trim()) return;
  stopSpeaking();

  // Premium głos przez Fish Audio (tani, topowy klon), jeśli podano klucz.
  if (settings.fishAudioApiKey && settings.fishAudioVoiceId) {
    try {
      const res = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
          authorization: `Bearer ${settings.fishAudioApiKey}`,
          "content-type": "application/json",
          model: "s1",
        },
        body: JSON.stringify({ text, reference_id: settings.fishAudioVoiceId, format: "mp3" }),
      });
      if (await playFromResponse(res)) return;
    } catch {
      /* fallback niżej */
    }
  }

  // Premium głos przez ElevenLabs (najbliżej oryginalnego JARVIS-a), jeśli podano klucz.
  if (settings.elevenLabsApiKey && settings.elevenLabsVoiceId) {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${settings.elevenLabsVoiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": settings.elevenLabsApiKey,
            "content-type": "application/json",
            accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.4, similarity_boost: 0.85 },
          }),
        },
      );
      if (await playFromResponse(res)) return;
    } catch {
      /* fallback do systemowego TTS */
    }
  }

  // Na urządzeniu używaj natywnego TTS (WebView często nie ma Web Speech).
  if (Capacitor.isNativePlatform()) {
    try {
      await NativeTTS.speak({ text, pitch: settings.voicePitch, rate: settings.voiceRate, lang: "pl-PL" });
      return;
    } catch {
      /* fallback do Web Speech */
    }
  }

  const synth = window.speechSynthesis;
  if (!synth) return;
  // Na Androidzie lista głosów bywa pusta przy starcie — poczekaj na nią.
  if (!cachedVoices.length) await loadVoices();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(settings);
  if (v) u.voice = v;
  u.pitch = settings.voicePitch;
  u.rate = settings.voiceRate;
  u.lang = v?.lang || "pl-PL";
  try {
    synth.resume();
  } catch {
    /* ignore */
  }
  synth.speak(u);
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  if (Capacitor.isNativePlatform()) NativeTTS.stop().catch(() => {});
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

// --- Rozpoznawanie mowy (STT) ---

// Minimalne typy Web Speech API (brak ich w domyślnym lib.dom).
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}

function createRecognition(): SpeechRecognitionLike | null {
  const Ctor =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export const isSpeechSupported = (): boolean =>
  Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export interface ListenCallbacks {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onWake?: () => void;
  onEnd?: () => void;
  wakeWord?: boolean;
}

/**
 * Rozpoznawanie mowy. W trybie wakeWord nasłuchuje ciągle słowa „Jarvis”
 * i dopiero potem przekazuje komendę. W trybie zwykłym łapie jedną wypowiedź.
 */
export class Listener {
  private rec: SpeechRecognitionLike | null = null;
  private active = false;
  private cb: ListenCallbacks;

  constructor(cb: ListenCallbacks) {
    this.cb = cb;
  }

  start(lang = "pl-PL") {
    if (this.active) return;
    this.rec = createRecognition();
    if (!this.rec) return;
    this.active = true;
    this.rec.lang = lang;
    this.rec.continuous = Boolean(this.cb.wakeWord);
    this.rec.interimResults = true;

    let armed = !this.cb.wakeWord; // bez wakeWord od razu zbieramy komendę

    this.rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const transcript = r[0].transcript as string;
        if (r.isFinal) {
          const clean = transcript.trim();
          if (!armed) {
            if (/d[zż]+[ae]rwis|jarvis|dżarwis/i.test(clean)) {
              armed = true;
              this.cb.onWake?.();
            }
          } else if (clean) {
            const command = clean.replace(/^.*?(jarvis|dżarwis)[\s,:-]*/i, "").trim() || clean;
            this.cb.onFinal(command);
            if (this.cb.wakeWord) armed = false; // wróć do nasłuchu słowa-klucza
          }
        } else {
          interim += transcript;
        }
      }
      if (interim && armed) this.cb.onInterim?.(interim);
    };

    this.rec.onerror = () => {
      /* np. brak mowy — restart obsłuży onend */
    };

    this.rec.onend = () => {
      if (this.active && this.cb.wakeWord) {
        // tryb ciągły — wznawiaj
        try {
          this.rec?.start();
          return;
        } catch {
          /* ignore */
        }
      }
      this.active = false;
      this.cb.onEnd?.();
    };

    try {
      this.rec.start();
    } catch {
      this.active = false;
    }
  }

  stop() {
    this.active = false;
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
  }

  get listening() {
    return this.active;
  }
}
