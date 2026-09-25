// Voice provider catalog (mission 5.14, 5.15): model ids are data, not architecture. Every
// entry says what it can do (streaming, partials, Polish, function calling) and how sure we are
// of the id. The runtime picks providers from here; a dead id is never picked.

export type VoiceRole = "stt_streaming" | "stt_batch" | "tts_streaming" | "live_conversation";
export type EntryStatus = "default" | "optional" | "fallback" | "dead";

export interface VoiceProviderEntry {
  id: string;
  vendor: "google" | "deepgram" | "openai" | "groq" | "elevenlabs" | "browser";
  role: VoiceRole;
  /** The provider's model id, as sent on the wire. */
  model: string;
  polish: boolean;
  partials: boolean;
  /** Live models only: can the model keep talking while a function runs? */
  functionCalling?: "NON_BLOCKING" | "BLOCKING" | "none";
  /** Settings key (not a value) holding the credential; none for built-in engines. */
  credential?: "gemini" | "deepgram" | "openai" | "groq" | "elevenlabs";
  status: EntryStatus;
  /** Where the id comes from and when it was last checked against official docs. */
  source: string;
  verified: boolean;
}

export const VOICE_CATALOG: readonly VoiceProviderEntry[] = [
  // Conversation lane (optional adapter that may talk while the action lane works).
  {
    id: "gemini-live", vendor: "google", role: "live_conversation", model: "gemini-3.8-live",
    polish: true, partials: true, functionCalling: "NON_BLOCKING", credential: "gemini", status: "default",
    source: "mission brief 5.14 (official docs unreachable from the build session, network policy)", verified: false,
  },
  {
    id: "gemini-live-native-audio", vendor: "google", role: "live_conversation", model: "gemini-2.5-flash-preview-native-audio-dialog",
    polish: true, partials: true, functionCalling: "BLOCKING", credential: "gemini", status: "optional",
    source: "existing app setting (preview, affective dialog)", verified: false,
  },
  {
    id: "gemini-live-2.0", vendor: "google", role: "live_conversation", model: "gemini-2.0-flash-live-001",
    polish: true, partials: true, functionCalling: "BLOCKING", credential: "gemini", status: "dead",
    source: "shut down by Google (mission brief, section 1)", verified: true,
  },
  // Streaming STT with Polish (at least two, mission 5.14).
  {
    id: "deepgram-nova-3", vendor: "deepgram", role: "stt_streaming", model: "nova-3",
    polish: true, partials: true, credential: "deepgram", status: "default",
    source: "Deepgram live streaming API (interim results, endpointing, UtteranceEnd)", verified: false,
  },
  {
    id: "openai-realtime-transcribe", vendor: "openai", role: "stt_streaming", model: "gpt-4o-transcribe",
    polish: true, partials: true, credential: "openai", status: "optional",
    source: "OpenAI Realtime transcription sessions (delta and completed events)", verified: false,
  },
  {
    id: "browser-web-speech", vendor: "browser", role: "stt_streaming", model: "webkitSpeechRecognition",
    polish: true, partials: true, status: "optional",
    source: "Web Speech API (interimResults); not available inside Electron", verified: true,
  },
  // Batch fallback: the current app path.
  {
    id: "groq-whisper", vendor: "groq", role: "stt_batch", model: "whisper-large-v3-turbo",
    polish: true, partials: false, credential: "groq", status: "fallback",
    source: "src/lib/transcribe.ts", verified: true,
  },
  // TTS.
  {
    id: "elevenlabs-multilingual", vendor: "elevenlabs", role: "tts_streaming", model: "eleven_multilingual_v2",
    polish: true, partials: false, credential: "elevenlabs", status: "optional",
    source: "src/lib/voice.ts", verified: true,
  },
  {
    id: "system-tts", vendor: "browser", role: "tts_streaming", model: "speechSynthesis",
    polish: true, partials: false, status: "fallback",
    source: "Web Speech synthesis", verified: true,
  },
];

const RANK: Record<EntryStatus, number> = { default: 0, optional: 1, fallback: 2, dead: 99 };

/**
 * Providers for a role, best first: usable (credential present or none needed), never dead.
 * `has(credential)` answers whether a key exists; values are never read here.
 */
export function providerChain(role: VoiceRole, has: (credential: NonNullable<VoiceProviderEntry["credential"]>) => boolean, opts: { polish?: boolean } = {}): VoiceProviderEntry[] {
  return VOICE_CATALOG
    .filter((e) => e.role === role && e.status !== "dead" && (!opts.polish || e.polish) && (!e.credential || has(e.credential)))
    .sort((a, b) => RANK[a.status] - RANK[b.status]);
}

/** Streaming STT first, then the batch fallback, as one ordered chain. */
export function sttChain(has: Parameters<typeof providerChain>[1], opts: { browserSpeech?: boolean } = {}): VoiceProviderEntry[] {
  const streaming = providerChain("stt_streaming", has, { polish: true }).filter((e) => e.vendor !== "browser" || opts.browserSpeech);
  return [...streaming, ...providerChain("stt_batch", has, { polish: true })];
}

/** The Live API resource name for a catalog entry (`models/<id>`). */
export const liveResource = (e: VoiceProviderEntry): string => `models/${e.model}`;

export function catalogEntry(id: string): VoiceProviderEntry | undefined {
  return VOICE_CATALOG.find((e) => e.id === id);
}

/** Map a stored model id to a usable one: dead ids fall back to the role's default. */
export function resolveLiveModel(stored?: string): VoiceProviderEntry {
  const clean = (stored ?? "").replace(/^models\//, "");
  const hit = VOICE_CATALOG.find((e) => e.role === "live_conversation" && e.model === clean);
  if (hit && hit.status !== "dead") return hit;
  return VOICE_CATALOG.find((e) => e.role === "live_conversation" && e.status === "default") as VoiceProviderEntry;
}
