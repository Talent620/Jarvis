import { primaryKey } from "./keys";

// Transkrypcja audio przez Groq Whisper (whisper-large-v3-turbo) — darmowy tier
// (~2000/dzień), endpoint zgodny z OpenAI. Świetne do transkrypcji spotkań/notatek
// głosowych. Wymaga klucza Groq (ten sam, którego JARVIS używa do czatu).

export async function transcribeAudio(blob: Blob, lang = "pl"): Promise<{ text: string } | { error: string }> {
  const key = primaryKey("groq");
  if (!key) return { error: "Transkrypcja używa Groq (darmowy) — dodaj klucz Groq w ⚙ → AI." };
  try {
    const form = new FormData();
    form.append("file", blob, "nagranie.webm");
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", lang);
    form.append("response_format", "json");
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) return { error: d?.error?.message || `Błąd transkrypcji (${res.status}).` };
    return { text: (d.text || "").trim() };
  } catch (e) {
    return { error: `Błąd połączenia: ${e instanceof Error ? e.message : e}` };
  }
}

export const transcribeSupported = (): boolean =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof (window as any).MediaRecorder !== "undefined";
