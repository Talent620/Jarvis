import { primaryKey } from "./keys";
import { fetchTimeout } from "./http";
import { store } from "./store";
import { transcribeLocal, localSttUsable } from "./localWhisper";

// Transkrypcja audio przez Groq Whisper (whisper-large-v3-turbo) — darmowy tier
// (~2000/dzień), endpoint zgodny z OpenAI. Świetne do transkrypcji spotkań/notatek
// głosowych. Wymaga klucza Groq (ten sam, którego JARVIS używa do czatu).
// PREFERENCJA on-device: gdy localStt włączone i wspierane, transkrybujemy lokalnie
// (Whisper/Transformers.js) — prywatnie i bez limitu; przy niepowodzeniu fallback do Groq.

// Mapowanie kodu języka (pl) → nazwa oczekiwana przez Whisper (polish).
const WHISPER_LANG: Record<string, string> = { pl: "polish", en: "english", de: "german", es: "spanish", fr: "french", uk: "ukrainian", ru: "russian" };

export async function transcribeAudio(blob: Blob, lang = "pl"): Promise<{ text: string } | { error: string }> {
  // 1) On-device (opcja): prywatnie, bez klucza/limitu.
  if (store.settings.localStt && localSttUsable()) {
    const local = await transcribeLocal(blob, WHISPER_LANG[lang.slice(0, 2)] || "polish");
    if (local && local.trim()) return { text: local.trim() };
    // null/puste → fallback do chmury poniżej
  }

  const key = primaryKey("groq");
  if (!key) {
    return {
      error: store.settings.localStt
        ? "Transkrypcja on-device niedostępna (brak WebGPU/sieci przy pierwszym pobraniu), a brak klucza Groq jako zapasu — dodaj klucz Groq w ⚙ → AI."
        : "Transkrypcja używa Groq (darmowy) — dodaj klucz Groq w ⚙ → AI.",
    };
  }
  try {
    const form = new FormData();
    form.append("file", blob, "nagranie.webm");
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", lang);
    form.append("response_format", "json");
    const res = await fetchTimeout("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
    }, 60000);
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) return { error: d?.error?.message || `Błąd transkrypcji (${res.status}).` };
    return { text: (d.text || "").trim() };
  } catch (e) {
    return { error: `Błąd połączenia: ${e instanceof Error ? e.message : e}` };
  }
}

export const transcribeSupported = (): boolean =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof (window as any).MediaRecorder !== "undefined";
