// === proxy/lib/voiceProtocol.js — serwerowe wsparcie voice_mode i 3 trybów osobowości w BFF ===
// Gdy klient wysyła `voice_mode: true` w body OpenAI/Modal lub nagłówek `x-voice-mode: 1`,
// Worker wstrzykuje protokół mówionej polszczyzny do wiadomości systemowej i usuwa niestandardowe pola
// przed przesłaniem do upstreamu (vLLM/OpenAI/Groq/Anthropic).

export const VOICE_MODE_SYSTEM_RULE =
  "PROTOKÓŁ MÓWIONEJ POLSZCZYZNY (voice_mode): odpowiadaj w max 2-3 krótkich, naturalnych zdaniach; " +
  "zero list punktowanych, zero markdowna, zero czytania URL-i; naturalny rytm pod TTS z barge-in.";

/** Pure: wzbogać body OpenAI-compatible o dyrektywę voice_mode, gdy włączony, i oczyść payload. */
export function applyVoiceModeToOpenAiBody(rawText, headerVoiceMode = false) {
  try {
    const body = JSON.parse(rawText);
    const active = Boolean(body?.voice_mode || headerVoiceMode);
    if (!body || typeof body !== "object") return rawText;
    if ("voice_mode" in body) delete body.voice_mode;
    if (!active) return JSON.stringify(body);
    if (Array.isArray(body.messages)) {
      const sys = body.messages.find((m) => m && m.role === "system");
      if (sys && typeof sys.content === "string") {
        if (!sys.content.includes("PROTOKÓŁ MÓWIONEJ POLSZCZYZNY")) {
          sys.content = `${sys.content}\n\n${VOICE_MODE_SYSTEM_RULE}`;
        }
      } else {
        body.messages.unshift({ role: "system", content: VOICE_MODE_SYSTEM_RULE });
      }
    }
    return JSON.stringify(body);
  } catch {
    return rawText;
  }
}
