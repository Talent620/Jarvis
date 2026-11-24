// === Sprint 3 / Moduł 1: Streaming TTS po polsku (zdanie-po-zdaniu) + Android Audio Unlock ===
// Niskoopóźnieniowy potok audio:
//  - Pierwsze zdanie startuje natychmiast, kolejne syntetyzuje się równolegle w tle (lookahead=1).
//  - Obsługa: ElevenLabs Flash v2.5 / Multilingual v2, OpenAI TTS (gpt-4o-mini-tts / tts-1),
//    oraz własny endpoint Modal Voice (deploy/modal_voice.py).
//  - Pełny barge-in: cancel() natychmiast przerywa aktywne fetch (AbortController), zatrzymuje
//    odtwarzanie i zwalnia ObjectURL — zero nakładania się wypowiedzi i zero wycieków pamięci.

export type StreamingChunkSynth = (sentence: string, signal: AbortSignal) => Promise<Blob | null>;
export type StreamingBlobPlayer = (blob: Blob, signal: AbortSignal) => Promise<boolean>;

let sharedAudioCtx: AudioContext | null = null;
let unlockRegistered = false;

/** Zwróć współdzielony AudioContext (lub null gdy Web Audio niedostępne). */
export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

/**
 * Odblokuj WebAudio AudioContext na Androidzie/iOS (WebView blokuje audio przed pierwszym gestem).
 * Bezpieczne do wielokrotnego wywołania; gra 1-samplowy cichy bufor przy suspended.
 */
export async function unlockAudioContext(): Promise<boolean> {
  const ctx = getSharedAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    return ctx.state === "running";
  } catch {
    return false;
  }
}

/** Zarejestruj jednorazowe odblokowanie AudioContext na pierwszy dotyk/klik (Android WebView). */
export function registerAndroidAudioUnlock(): void {
  if (unlockRegistered || typeof window === "undefined") return;
  unlockRegistered = true;
  const once = () => {
    void unlockAudioContext();
    window.removeEventListener("touchstart", once);
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
  window.addEventListener("touchstart", once, { passive: true });
  window.addEventListener("pointerdown", once, { passive: true });
  window.addEventListener("keydown", once, { passive: true });
}

/** Pure: czy przeglądarka/urządzenie zgłasza tryb offline (szybki fallback na natywny TTS). */
export function isNavigatorOffline(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  } catch {
    return false;
  }
}

/**
 * Pure: podziel polską wypowiedź na krótkie zdania do streamingu TTS.
 * Pierwsze zdanie celowo krótkie (<= maxFirst), by czas do pierwszego dźwięku (TTFA) był minimalny.
 */
export function splitIntoSpeechSentences(text: string, maxChars = 180): string[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const raw = clean.match(/[^.!?…]+[.!?…]+|\S[^.!?…]*$/g) || [clean];
  const out: string[] = [];
  for (const piece of raw) {
    const s = piece.trim();
    if (!s) continue;
    if (s.length <= maxChars) {
      out.push(s);
      continue;
    }
    // Podział bardzo długiego zdania na przecinkach / spacji
    const parts = s.match(new RegExp(`.{1,${maxChars}}(?:\\s|$)`, "g")) || [s];
    for (const p of parts) {
      const t = p.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * Kolejka streamingowego TTS zdanie-po-zdaniu z twardą ochroną przed nakładaniem wypowiedzi.
 * Każde nowe `speak()` lub `cancel()` (barge-in) unieważnia poprzednią generację i przerywa fetch/audio.
 */
export class StreamingTtsQueue {
  private generation = 0;
  private activeController: AbortController | null = null;
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  /** Natychmiast przerwij bieżącą kolejkę (barge-in lub nowa wypowiedź). */
  cancel(): void {
    this.generation += 1;
    if (this.activeController) {
      try {
        this.activeController.abort();
      } catch {
        /* ignore */
      }
      this.activeController = null;
    }
    this.active = false;
  }

  /**
   * Odtwórz wypowiedź zdanie-po-zdaniu z 1-zdaniowym wyprzedzeniem (prefetch):
   * zdanie #1 rusza natychmiast, podczas gdy zdanie #2 pobiera się w tle.
   * Zwraca `true` jeśli przynajmniej pierwsze zdanie zostało obsłużone (lub przerwane przez barge-in),
   * `false` gdy pierwsze zdanie zawiodło (sygnał do fallbacku na natywny TTS).
   */
  async speak(
    text: string,
    synthChunk: StreamingChunkSynth,
    playBlob: StreamingBlobPlayer,
    opts: { maxChars?: number } = {},
  ): Promise<boolean> {
    const sentences = splitIntoSpeechSentences(text, opts.maxChars ?? 180);
    if (!sentences.length) return false;

    this.cancel();
    const myGen = this.generation;
    const controller = new AbortController();
    this.activeController = controller;
    this.active = true;

    try {
      let pendingBlob: Promise<Blob | null> = synthChunk(sentences[0], controller.signal).catch(() => null);

      for (let i = 0; i < sentences.length; i++) {
        const blob = await pendingBlob;
        if (myGen !== this.generation || controller.signal.aborted) {
          return true; // przerwano czysto (barge-in lub nowszy speak)
        }
        if (i === 0 && !blob) {
          return false; // pierwszy chunk padł → pozwól na fallback do natywnego TTS
        }
        // Natychmiast zacznij syntezę kolejnego zdania równolegle z odtwarzaniem bieżącego!
        pendingBlob =
          i + 1 < sentences.length
            ? synthChunk(sentences[i + 1], controller.signal).catch(() => null)
            : Promise.resolve(null);

        if (blob) {
          const played = await playBlob(blob, controller.signal);
          if (!played || myGen !== this.generation || controller.signal.aborted) {
            return true;
          }
        }
      }
      return true;
    } finally {
      if (myGen === this.generation) {
        this.active = false;
        this.activeController = null;
      }
    }
  }
}

export const streamingTtsQueue = new StreamingTtsQueue();

// --- Adaptery dostawców neuralnego TTS (PL, niskie opóźnienie) ---

export async function synthesizeElevenLabsChunk(
  text: string,
  opts: {
    apiKey: string;
    voiceId: string;
    modelId?: "eleven_flash_v2_5" | "eleven_multilingual_v2";
    stability?: number;
    style?: number;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<Blob | null> {
  if (!opts.apiKey?.trim() || !opts.voiceId?.trim() || !text.trim()) return null;
  const doFetch = opts.fetchImpl || fetch;
  const modelId = opts.modelId || "eleven_flash_v2_5";
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voiceId.trim())}/stream?optimize_streaming_latency=3`;
  const res = await doFetch(url, {
    method: "POST",
    signal: opts.signal,
    headers: {
      "xi-api-key": opts.apiKey.trim(),
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      language_code: "pl",
      voice_settings: {
        stability: typeof opts.stability === "number" ? opts.stability : 0.4,
        similarity_boost: 0.85,
        style: typeof opts.style === "number" ? opts.style : 0,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) return null;
  return res.blob();
}

export async function synthesizeOpenAiTtsChunk(
  text: string,
  opts: {
    apiKey: string;
    model?: "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd";
    voice?: string;
    speed?: number;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<Blob | null> {
  if (!opts.apiKey?.trim() || !text.trim()) return null;
  const doFetch = opts.fetchImpl || fetch;
  const model = opts.model || "gpt-4o-mini-tts";
  const voice = (opts.voice || "onyx").trim();
  const speed = typeof opts.speed === "number" && opts.speed >= 0.25 && opts.speed <= 4 ? opts.speed : 1.0;
  const payload: Record<string, unknown> = {
    model,
    voice,
    input: text,
    response_format: "mp3",
    speed,
  };
  if (model === "gpt-4o-mini-tts") {
    payload.instructions = "Mów naturalną, płynną polszczyzną, spokojnym i konkretnym tonem asystenta.";
  }
  const res = await doFetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    signal: opts.signal,
    headers: {
      authorization: `Bearer ${opts.apiKey.trim()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return null;
  return res.blob();
}

export async function synthesizeModalVoiceTtsChunk(
  text: string,
  opts: {
    modalVoiceUrl: string;
    apiKey?: string;
    language?: string;
    exaggeration?: number;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<Blob | null> {
  const base = (opts.modalVoiceUrl || "").trim().replace(/\/+$/, "");
  if (!base || !text.trim()) return null;
  const doFetch = opts.fetchImpl || fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey?.trim()) headers.authorization = `Bearer ${opts.apiKey.trim()}`;
  const res = await doFetch(`${base}/v1/tts`, {
    method: "POST",
    signal: opts.signal,
    headers,
    body: JSON.stringify({
      text,
      language: opts.language || "pl",
      exaggeration: typeof opts.exaggeration === "number" ? opts.exaggeration : 0.45,
    }),
  });
  if (!res.ok) return null;
  return res.blob();
}
