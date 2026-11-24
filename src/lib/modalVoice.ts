// === Modal Voice (Full-Duplex STT/TTS + Barge-In) ===
// Klient dla deploy/modal_voice.py oraz deterministyczny kontroler przerywania wypowiedzi
// (barge-in): gdy użytkownik zaczyna mówić podczas odtwarzania TTS, natychmiast przerywa
// bieżący strumień HTTP (AbortController) oraz dźwięk i oddaje mikrofon.
import { appTokenHeader } from "./http";
import { store } from "./store";

/** Pure: znormalizuj bazowy adres Modal Voice (bez końcowego ukośnika). */
export function normalizeModalVoiceUrl(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return withScheme.replace(/\/+$/, "").replace(/\/v1\/(stt|tts|duplex)$/i, "");
}

export interface BargeInOptions {
  /** Próg energii RMS (0..1) powyżej którego uznajemy głos użytkownika. Domyślnie 0.08. */
  threshold?: number;
  /** Liczba kolejnych ramek powyżej progu wymagana do wywołania barge-in (chroni przed trzaskiem). */
  minFrames?: number;
  /** Callback przerywający bieżący TTS/audio. */
  onInterrupt: () => void;
}

/**
 * Pure/deterministyczny kontroler Barge-In dla trybu full-duplex.
 * Śledzi aktywne żądanie TTS (AbortController) i monitoruje energię mikrofonu — po wykryciu
 * mowy użytkownika w trakcie mówienia JARVIS-a przerywa natychmiast strumień i odtwarzanie.
 */
export class BargeInController {
  private speaking = false;
  private hotFrames = 0;
  private controller: AbortController | null = null;
  private readonly threshold: number;
  private readonly minFrames: number;
  private readonly onInterrupt: () => void;

  constructor(opts: BargeInOptions) {
    this.threshold = opts.threshold ?? 0.08;
    this.minFrames = Math.max(1, opts.minFrames ?? 3);
    this.onInterrupt = opts.onInterrupt;
  }

  /** Rozpocznij nową wypowiedź TTS i zwróć świeży AbortSignal do podpięcia pod fetch/stream. */
  beginSpeaking(): AbortSignal {
    this.controller?.abort();
    this.controller = new AbortController();
    this.speaking = true;
    this.hotFrames = 0;
    return this.controller.signal;
  }

  /** Zakończ wypowiedź normalnie (bez przerwania). */
  endSpeaking(): void {
    this.speaking = false;
    this.hotFrames = 0;
    this.controller = null;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  /** Karm próbką głośności mikrofonu (RMS 0..1). Zwraca true w chwili wyzwolenia barge-in. */
  feedMicLevel(rms: number): boolean {
    if (!this.speaking) {
      this.hotFrames = 0;
      return false;
    }
    if (rms >= this.threshold) {
      this.hotFrames++;
      if (this.hotFrames >= this.minFrames) {
        this.interrupt();
        return true;
      }
    } else {
      this.hotFrames = 0;
    }
    return false;
  }

  /** Natychmiast przerwij wypowiedź (np. wykryty głos użytkownika lub przycisk STOP). */
  interrupt(): void {
    if (!this.speaking && !this.controller) return;
    this.speaking = false;
    this.hotFrames = 0;
    const c = this.controller;
    this.controller = null;
    try { c?.abort(); } catch { /* ignore */ }
    this.onInterrupt();
  }
}

function voiceTarget(path: "/v1/stt" | "/v1/tts"): { url: string; headers: Record<string, string> } | null {
  const direct = normalizeModalVoiceUrl(store.settings.modalVoiceUrl || "");
  const key = (store.settings.keys?.modal || "").trim();
  const proxy = (store.settings.proxyUrl || "").trim().replace(/\/+$/, "");

  if (direct) {
    return {
      url: `${direct}${path}`,
      headers: key ? { authorization: `Bearer ${key}` } : {},
    };
  }
  if (proxy) {
    const suffix = path === "/v1/stt" ? "/modal-voice/stt" : "/modal-voice/tts";
    return {
      url: `${proxy}${suffix}`,
      headers: {
        ...appTokenHeader(),
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
    };
  }
  return null;
}

/** Czy skonfigurowano usługę Modal Voice (bezpośrednio lub przez BFF). */
export function modalVoiceConfigured(): boolean {
  return !!(normalizeModalVoiceUrl(store.settings.modalVoiceUrl || "") || store.settings.proxyUrl?.trim());
}

/** Transkrypcja audio przez Modal Voice (faster-whisper large-v3-turbo, PL). */
export async function transcribeModalStt(
  audio: Blob,
  opts: { language?: string; signal?: AbortSignal } = {},
): Promise<{ text: string; language: string; latencyMs: number }> {
  const t = voiceTarget("/v1/stt");
  if (!t) throw new Error("Brak adresu Modal Voice (modalVoiceUrl / proxyUrl).");
  const url = `${t.url}?language=${encodeURIComponent(opts.language || "pl")}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...t.headers, "content-type": audio.type || "audio/webm" },
    body: audio,
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Modal STT HTTP ${res.status}`);
  const data = (await res.json()) as { text?: string; language?: string; latency_ms?: number };
  return {
    text: String(data.text || "").trim(),
    language: String(data.language || opts.language || "pl"),
    latencyMs: Number(data.latency_ms || 0),
  };
}

/** Synteza mowy przez Modal Voice (streaming WAV, natychmiast przerywalna przez AbortSignal). */
export async function fetchModalTtsAudio(
  text: string,
  opts: { language?: string; exaggeration?: number; signal?: AbortSignal } = {},
): Promise<Blob> {
  const t = voiceTarget("/v1/tts");
  if (!t) throw new Error("Brak adresu Modal Voice (modalVoiceUrl / proxyUrl).");
  const res = await fetch(t.url, {
    method: "POST",
    headers: { ...t.headers, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      language: opts.language || "pl",
      exaggeration: opts.exaggeration ?? 0.45,
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Modal TTS HTTP ${res.status}`);
  return await res.blob();
}
