import type { Settings } from "../types";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { setLevel } from "./audioLevel";
import { primaryKey } from "./keys";
import { fetchTimeout } from "./http";
import { WhisperListener } from "./whisperListener";
import { synthLocal, localTtsUsable } from "./localTts";
import { logError } from "./errorLog";

// Natywny silnik mowy Androida (pewniejszy niż Web Speech w WebView).
export interface NativeVoiceInfo { name: string; lang: string; quality?: number; network?: boolean }
interface NativeTtsPlugin {
  speak(o: { text: string; pitch: number; rate: number; lang: string; voice?: string }): Promise<void>;
  listVoices(): Promise<{ voices: NativeVoiceInfo[] }>;
  stop(): Promise<void>;
}
const NativeTTS = registerPlugin<NativeTtsPlugin>("NativeTTS");

/** Lista dostępnych głosów do wyboru w ustawieniach — natywne (Android) albo przeglądarkowe.
 *  Android ma własny silnik (NativeTTS); iOS i web używają Web Speech (WKWebView/przeglądarka). */
export async function listSpeechVoices(): Promise<NativeVoiceInfo[]> {
  if (Capacitor.getPlatform?.() === "android") {
    try {
      const r = await NativeTTS.listVoices();
      const list = (r?.voices || []).filter((v) => v.name);
      if (list.length) return list;
    } catch {
      /* spadnij do Web Speech */
    }
  }
  const voices = cachedVoices.length ? cachedVoices : await loadVoices();
  return voices.map((v) => ({ name: v.name, lang: v.lang }));
}

/** Pure: ocena jakości głosu (im wyżej, tym lepiej). Preferuje wysoką jakość, sieciowy/Google. */
export function voiceQualityScore(v: NativeVoiceInfo): number {
  return (
    (v.quality || 0) +
    (v.network ? 50 : 0) + // głosy sieciowe Google brzmią naturalniej
    (/google/i.test(v.name) ? 30 : 0) +
    (/-x-|local/i.test(v.name) ? 5 : 0)
  );
}

/** Pure: wskaż „najlepszy" polski głos z listy (najwyższa jakość). Zwraca nazwę albo "" gdy brak PL. */
export function bestPlVoiceName(voices: NativeVoiceInfo[]): string {
  const pl = voices.filter((v) => /^pl/i.test(v.lang || ""));
  if (!pl.length) return "";
  return [...pl].sort((a, b) => voiceQualityScore(b) - voiceQualityScore(a))[0].name;
}

export interface VoiceGuardResult { changed: boolean; from: string; to: string; reason: "ok" | "missing" | "none" }
/**
 * Voice Guardian (start aplikacji): sprawdź, czy PRZYPIĘTY głos (voiceName) nadal istnieje
 * w silniku. Jeśli zniknął (aktualizacja systemu, usunięcie pakietu) — wybierz najlepszy
 * polski zamiennik i zapisz go. Czysty wynik (decyzję o zapisie podejmuje caller).
 */
export async function checkPinnedVoice(): Promise<VoiceGuardResult> {
  const { store } = await import("./store");
  const pinned = store.settings.voiceName?.trim();
  if (!pinned) return { changed: false, from: "", to: "", reason: "ok" };
  const voices = await listSpeechVoices();
  if (!voices.length) return { changed: false, from: pinned, to: pinned, reason: "ok" }; // lista pusta — nie ruszaj
  if (voices.some((v) => v.name === pinned)) return { changed: false, from: pinned, to: pinned, reason: "ok" };
  const replacement = bestPlVoiceName(voices);
  return { changed: !!replacement, from: pinned, to: replacement, reason: replacement ? "missing" : "none" };
}

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
    let settled = false;
    const finish = (v: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      synth.onvoiceschanged = null; // nie zostawiaj wiszącego handlera na globalnym synth
      clearTimeout(timer);
      resolve(v);
    };
    synth.onvoiceschanged = () => {
      cachedVoices = synth.getVoices();
      finish(cachedVoices);
    };
    // Fallback, gdyby zdarzenie nie wystąpiło.
    const timer = setTimeout(() => finish(cachedVoices.length ? cachedVoices : synth.getVoices()), 500);
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
  // Odpowiedzi są PO POLSKU — domyślnie wybierz najlepszy POLSKI głos, by czytał poprawnie
  // (angielski głos mówiący po polsku brzmi fatalnie). Najlepszy głos JARVIS-a = naturalny PL.
  const pl = voices.filter((v) => v.lang.toLowerCase().startsWith("pl"));
  if (pl.length) {
    const PL_PREF = ["zofia", "marek", "krzysztof", "adam", "paulina", "google", "microsoft", "natural"];
    for (const h of PL_PREF) { const v = pl.find((x) => x.name.toLowerCase().includes(h)); if (v) return v; }
    return pl[0];
  }
  // Brak polskiego głosu w systemie → klasyczny głos JARVIS-a (angielski) jako fallback.
  for (const hint of JARVIS_HINTS) {
    const v = voices.find((x) => x.name.toLowerCase().includes(hint));
    if (v) return v;
  }
  return voices.find((v) => v.lang.toLowerCase().startsWith("en")) || voices[0];
}

let currentAudio: HTMLAudioElement | null = null;
let levelCtx: AudioContext | null = null;
let levelRaf = 0;

// Odtwórz URL audio i napędzaj poziom głośności (orb „mówi" w rytm dźwięku).
// Web Audio jest opcjonalne — przy jakimkolwiek błędzie zwykłe odtwarzanie działa.
async function playUrlWithLevel(url: string): Promise<void> {
  const audio = new Audio(url);
  currentAudio = audio;
  let srcNode: MediaElementAudioSourceNode | null = null;
  let analyserNode: AnalyserNode | null = null;
  // Sprzątanie: odłącz węzły Web Audio — inaczej akumulują się na współdzielonym
  // levelCtx przy każdym premium-TTS (wyciek pamięci + CPU w wątku audio).
  const cleanup = () => {
    try { srcNode?.disconnect(); } catch { /* ignore */ }
    try { analyserNode?.disconnect(); } catch { /* ignore */ }
    cancelAnimationFrame(levelRaf);
    setLevel(0);
  };
  audio.onended = () => {
    URL.revokeObjectURL(url);
    cleanup();
  };
  audio.onerror = () => cleanup();
  try {
    levelCtx = levelCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = levelCtx;
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    srcNode = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyserNode = analyser;
    analyser.fftSize = 256;
    srcNode.connect(ctx.destination); // audio zawsze słychać
    srcNode.connect(analyser); // odczep do pomiaru poziomu (bez dalszego routingu)
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const c = (v - 128) / 128;
        sum += c * c;
      }
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
      levelRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    /* Web Audio niedostępne — odtwarzaj normalnie, bez wizualizacji */
  }
  await audio.play();
}

async function playFromResponse(res: Response): Promise<boolean> {
  if (!res.ok) return false;
  const blob = await res.blob();
  await playUrlWithLevel(URL.createObjectURL(blob));
  return true;
}

// Token przerwania — stopSpeaking() go zwiększa, więc trwające czytanie
// (potokowe, po kawałkach) wie, że ma się zatrzymać.
let speakToken = 0;
// Czy JARVIS aktualnie mówi (odtwarza TTS). Nasłuch mowy (whisperListener) wycisza wtedy
// wejście, by nie rozpoznawać własnego głosu (koniec echa/samowyzwalania — dług z AUDIT.md).
let speakingDepth = 0;
export function isSpeaking(): boolean {
  return speakingDepth > 0;
}
// Jawne przerwanie bieżącego odtwarzania (ustawiane przez playUrlEnded).
// Pewniejsze niż zdarzenie „pause", które bywa odpalane także przy końcu utworu.
let interruptPlayback: (() => void) | null = null;

/** Podziel tekst na krótkie kawałki na granicach zdań (do szybkiego startu głosu). */
export function splitForSpeech(text: string, max = 200): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]+|\S[^.!?…]*$/g) || [clean];
  const out: string[] = [];
  let buf = "";
  const push = () => { if (buf.trim()) out.push(buf.trim()); buf = ""; };
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if ((buf + " " + s).trim().length <= max) { buf = (buf ? buf + " " : "") + s; continue; }
    push();
    if (s.length <= max) { buf = s; continue; }
    // Bardzo długie zdanie → twardy podział, ostatni fragment zostaje w buforze.
    const parts = s.match(new RegExp(`.{1,${max}}(\\s|$)`, "g")) || [s];
    for (let i = 0; i < parts.length - 1; i++) out.push(parts[i].trim());
    buf = parts[parts.length - 1].trim();
  }
  push();
  return out;
}

/** Odtwórz URL i rozwiąż, gdy SKOŃCZY (albo przerwano). Napędza poziom orba. */
function playUrlEnded(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;
    let done = false;
    let srcNode: MediaElementAudioSourceNode | null = null;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      interruptPlayback = null;
      try { srcNode?.disconnect(); } catch { /* ignore */ }
      URL.revokeObjectURL(url);
      cancelAnimationFrame(levelRaf);
      setLevel(0);
      resolve(ok);
    };
    interruptPlayback = () => finish(false); // wywoła to stopSpeaking()
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    try {
      levelCtx = levelCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = levelCtx;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      srcNode = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      srcNode.connect(ctx.destination);
      srcNode.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) { const c = (v - 128) / 128; sum += c * c; }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
        levelRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* bez wizualizacji */
    }
    // play() bywa odrzucane (autoplay/urządzenie) — łap też wyjątek synchroniczny,
    // żeby nie zostawić nieobsłużonej obietnicy i czysto zakończyć odtwarzanie.
    try {
      const p = audio.play();
      if (p && typeof p.catch === "function") p.catch(() => finish(false));
    } catch {
      finish(false);
    }
  });
}

// Pakuje surowe PCM16 (z Gemini TTS) w nagłówek WAV, by dało się odtworzyć.
function pcmToWavUrl(b64: string, sampleRate: number): string {
  const bin = atob(b64);
  const len = bin.length;
  const buffer = new ArrayBuffer(44 + len);
  const view = new DataView(buffer);
  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + len, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, len, true);
  for (let i = 0; i < len; i++) view.setUint8(44 + i, bin.charCodeAt(i));
  return URL.createObjectURL(new Blob([view], { type: "audio/wav" }));
}

// Darmowy głos wysokiej jakości przez Gemini TTS (wymaga klucza Gemini).
// Wielojęzyczny i naturalny — mówi w języku tekstu (też ukraiński/polski),
// działa na każdej platformie (chmura), więc świetny do Trybu Tłumacza.
export async function geminiSpeak(text: string, voiceName?: string): Promise<boolean> {
  const key = primaryKey("gemini");
  if (!key || !text.trim()) return false;
  const voice = voiceName?.trim() || "Charon";
  const chunks = splitForSpeech(text);
  if (!chunks.length) return false;
  const token = ++speakToken; // przejmij „mówienie"; stopSpeaking() je unieważni

  // Synteza JEDNEGO kawałka → URL audio (albo null). Bez odtwarzania.
  const synth = async (chunk: string): Promise<string | null> => {
    try {
      const res = await fetchTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: chunk }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
          }),
        },
        30000,
      );
      if (!res.ok) return null;
      const d = await res.json();
      const part = (d?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData);
      const b64 = part?.inlineData?.data;
      if (!b64) return null;
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || "")?.[1]) || 24000;
      return pcmToWavUrl(b64, rate);
    } catch {
      return null;
    }
  };

  // Potok: czytaj bieżący kawałek, a kolejny generuj W TLE — głos startuje
  // po wygenerowaniu pierwszego krótkiego zdania, nie całej odpowiedzi.
  let next = synth(chunks[0]);
  for (let i = 0; i < chunks.length; i++) {
    const url = await next;
    if (token !== speakToken) return true; // przerwano (stopSpeaking)
    if (i === 0 && !url) return false; // pierwszy kawałek padł → fallback (głos systemowy), bez zbędnej syntezy
    next = i + 1 < chunks.length ? synth(chunks[i + 1]) : Promise.resolve(null);
    if (url) {
      const ok = await playUrlEnded(url);
      if (!ok || token !== speakToken) return true; // przerwane odtwarzanie
    }
  }
  return true;
}

// Głosy premium Gemini TTS — kilka naturalnych, z czytelnymi opisami.
export const TTS_VOICES: { id: string; label: string }[] = [
  { id: "Aoede", label: "Aoede — kobiecy, ciepły" },
  { id: "Kore", label: "Kore — kobiecy, wyrazisty" },
  { id: "Leda", label: "Leda — kobiecy, młody" },
  { id: "Callirrhoe", label: "Callirrhoe — kobiecy, łagodny" },
  { id: "Charon", label: "Charon — męski, spokojny" },
  { id: "Puck", label: "Puck — męski, żywy" },
  { id: "Orus", label: "Orus — męski, głęboki" },
];

async function geminiTts(text: string, settings: Settings): Promise<boolean> {
  return geminiSpeak(text, settings.geminiVoice?.trim() || "Charon");
}

export async function speak(text: string, settings: Settings): Promise<void> {
  if (!settings.speak || !text.trim()) return;
  stopSpeaking();
  const myToken = speakToken; // bieżąca „tura mówienia"; nowszy speak()/stop unieważni
  speakingDepth++;
  try {
  // Głos on-device (Kokoro) — prywatnie, bez chmury. Opcja; przy niepowodzeniu fallback niżej.
  if (settings.localTts && localTtsUsable()) {
    try {
      const blob = await synthLocal(text);
      if (myToken !== speakToken) return; // nowsza tura przejęła w czasie syntezy
      if (blob) { await playUrlWithLevel(URL.createObjectURL(blob)); return; }
    } catch {
      /* fallback do głosów chmurowych/systemowych niżej */
    }
  }

  // Premium głos przez Fish Audio (tani, topowy klon), jeśli podano klucz.
  if (settings.fishAudioApiKey && settings.fishAudioVoiceId) {
    try {
      const res = await fetchTimeout("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
          authorization: `Bearer ${settings.fishAudioApiKey}`,
          "content-type": "application/json",
          model: "s1",
        },
        body: JSON.stringify({ text, reference_id: settings.fishAudioVoiceId, format: "mp3" }),
      }, 30000);
      if (myToken !== speakToken) return; // nowsza tura przejęła w czasie pobierania
      if (await playFromResponse(res)) return;
    } catch {
      /* fallback niżej */
    }
  }

  // Prosty polski głos systemowy: pomiń chmurowe TTS (ElevenLabs/Gemini), które bywają z angielskim
  // akcentem i „zmieniają się" — idź prosto do natywnego/przeglądarkowego głosu PL (spójnie, offline).
  // Voice Guardian (voicePinned): „Używaj głosu JARVISA" wymusza ten tor i wyłącza WSZELKIE podmiany.
  const basicPl = settings.voicePinned || settings.voiceSystemPl !== false;

  // Premium głos przez ElevenLabs (najbliżej oryginalnego JARVIS-a), jeśli podano klucz.
  if (!basicPl && settings.elevenLabsApiKey && settings.elevenLabsVoiceId) {
    try {
      const res = await fetchTimeout(
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
        30000,
      );
      if (myToken !== speakToken) return; // nowsza tura przejęła w czasie pobierania
      if (await playFromResponse(res)) return;
    } catch {
      /* fallback do systemowego TTS */
    }
  }

  // Darmowy, wysokiej jakości głos przez Gemini TTS (najlepszy darmowy wybór) — chyba że prosty PL.
  if (!basicPl && settings.geminiTts !== false && primaryKey("gemini")) {
    if (await geminiTts(text, settings)) return;
  }

  // Android: natywny silnik TTS (WebView Androida często nie ma Web Speech) + WYBRANY głos
  // (bez tego silnik bierze domyślny „translatorowy", który się zmienia). iOS i web mają
  // sprawne Web Speech (WKWebView/przeglądarka) — używają pickVoice niżej.
  if (Capacitor.getPlatform?.() === "android") {
    try {
      await NativeTTS.speak({ text, pitch: settings.voicePitch, rate: settings.voiceRate, lang: "pl-PL", voice: settings.voiceName?.trim() || "" });
      return;
    } catch (e) {
      logError("tts", e, "native"); // zarejestruj błąd TTS — Voice Agent go pokaże
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
  } finally {
    speakingDepth = Math.max(0, speakingDepth - 1);
  }
}

export function stopSpeaking(): void {
  speakToken++; // przerwij trwające potokowe czytanie (Gemini, po kawałkach)
  speakingDepth = 0; // już nie mówimy — odblokuj nasłuch
  interruptPlayback?.(); // natychmiast rozwiąż bieżące odtwarzanie kawałka
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
  cancelAnimationFrame(levelRaf);
  setLevel(0);
}

/**
 * Przeczytaj tekst w KONKRETNYM języku (kod typu „uk-UA", „pl-PL") — dla Trybu
 * Tłumacza, niezależnie od głosu JARVIS-a. Na urządzeniu używa natywnego TTS,
 * w przeglądarce/desktopie dobiera głos pasujący do języka.
 */
export async function speakLang(text: string, ttsLang: string, opts?: { voice?: string; premium?: boolean }): Promise<void> {
  if (!text.trim()) return;
  stopSpeaking();
  // Głos PREMIUM (Gemini TTS) — naturalny, wielojęzyczny, działa wszędzie.
  // Idealny do tłumacza: ukraiński/polski brzmią jak żywy człowiek.
  if (opts?.premium !== false && primaryKey("gemini")) {
    if (await geminiSpeak(text, opts?.voice)) return;
  }
  if (Capacitor.getPlatform?.() === "android") {
    try {
      await NativeTTS.speak({ text, pitch: 1, rate: 1, lang: ttsLang });
      return;
    } catch {
      /* fallback do Web Speech */
    }
  }
  const synth = window.speechSynthesis;
  if (!synth) return;
  if (!cachedVoices.length) await loadVoices();
  const u = new SpeechSynthesisUtterance(text);
  const pref = ttsLang.slice(0, 2).toLowerCase();
  const v = cachedVoices.find((x) => x.lang.toLowerCase() === ttsLang.toLowerCase())
    || cachedVoices.find((x) => x.lang.toLowerCase().startsWith(pref));
  if (v) u.voice = v;
  u.lang = v?.lang || ttsLang;
  try { synth.resume(); } catch { /* ignore */ }
  synth.speak(u);
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

export function createRecognition(): SpeechRecognitionLike | null {
  const Ctor =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}
export type { SpeechRecognitionLike };

// Czy działamy w aplikacji desktopowej (Electron / Windows .exe). Tam wbudowane
// rozpoznawanie mowy przeglądarki (webkitSpeechRecognition) NIE działa — Chromium
// w Electronie nie ma klucza do serwerów mowy Google'a (mikrofon zapala się i gaśnie).
export const isDesktop = (): boolean =>
  typeof window !== "undefined" && !!(window as any).jarvisDesktop;

// Czy da się nagrywać audio (potrzebne dla silnika Whisper na desktopie).
const canRecordAudio = (): boolean =>
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof (window as any).MediaRecorder !== "undefined";

// Na desktopie „obsługa mowy" = możliwość nagrywania (resztę robi Whisper/Groq).
// W przeglądarce/telefonie = natywne Web Speech.
export const isSpeechSupported = (): boolean =>
  isDesktop()
    ? canRecordAudio()
    : Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export interface ListenCallbacks {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onWake?: () => void;
  onEnd?: () => void;
  onError?: (msg: string) => void;
  wakeWord?: boolean;
}

// Wspólny interfejs nasłuchu — Web Speech (Listener) i Whisper (WhisperListener)
// są wymienne, więc reszta aplikacji nie musi wiedzieć, który silnik działa.
export interface VoiceListener {
  start(lang?: string): void;
  stop(): void;
  readonly listening: boolean;
}

/**
 * Rozpoznawanie mowy. W trybie wakeWord nasłuchuje ciągle słowa „Jarvis”
 * i dopiero potem przekazuje komendę. W trybie zwykłym łapie jedną wypowiedź.
 */
export class Listener {
  private rec: SpeechRecognitionLike | null = null;
  private active = false;
  private cb: ListenCallbacks;
  // Anty-storm: zlicz puste, natychmiastowe restarty (utrata mic/sieci) → backoff i poddanie się.
  private restarts = 0;
  private gotResult = false;
  private restartTimer: number | null = null;

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
      this.gotResult = true; // produktywna sesja — zeruje licznik anty-stormu w onend
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
        // Sesja produktywna (był wynik) → restart natychmiast i zeruj licznik.
        // Pusta, natychmiastowa (utrata mic/sieci) → backoff; po 8 z rzędu poddaj się,
        // by nie pętlić w kółko obciążając CPU/silnik mowy.
        if (this.gotResult) this.restarts = 0;
        else this.restarts++;
        if (this.restarts > 8) {
          this.active = false;
          this.cb.onEnd?.();
          return;
        }
        const delay = this.gotResult ? 0 : Math.min(5000, 150 * 2 ** this.restarts);
        this.gotResult = false;
        this.restartTimer = window.setTimeout(() => {
          if (!this.active) return;
          try { this.rec?.start(); } catch { /* ignore */ }
        }, delay);
        return;
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
    this.restarts = 0;
    if (this.restartTimer != null) { clearTimeout(this.restartTimer); this.restartTimer = null; }
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

/**
 * Tworzy nasłuch dopasowany do platformy:
 *  - desktop (Electron/.exe) → WhisperListener (Groq Whisper), bo Web Speech tam nie działa,
 *  - telefon/przeglądarka → Listener (natywne Web Speech).
 * Dzięki temu mikrofon na Windowsie wreszcie działa (nie gaśnie po sekundzie).
 */
export function createListener(cb: ListenCallbacks): VoiceListener {
  if (isDesktop() && canRecordAudio()) return new WhisperListener(cb);
  return new Listener(cb);
}
