import { describe, it, expect, vi } from "vitest";
import {
  StreamingTtsQueue,
  splitIntoSpeechSentences,
  synthesizeElevenLabsChunk,
  synthesizeModalVoiceTtsChunk,
  synthesizeOpenAiTtsChunk,
} from "../src/lib/streamingTts";
import { activeVoiceLabel, resolveVoiceMode } from "../src/lib/voice";
import type { Settings } from "../src/types";

describe("Sprint 3 / Moduł 1 — Głos Premium (Streaming TTS po polsku + barge-in)", () => {
  it("dzieli polską wypowiedź na zdania pod szybki start (TTFA)", () => {
    const parts = splitIntoSpeechSentences(
      "Gotowe, serwer działa! Sprawdziłem logi na Modal. Nie ma żadnych błędów.",
    );
    expect(parts).toEqual([
      "Gotowe, serwer działa!",
      "Sprawdziłem logi na Modal.",
      "Nie ma żadnych błędów.",
    ]);
  });

  it("odtwarza zdanie #1 natychmiast, podczas gdy zdanie #2 syntetyzuje się równolegle w tle", async () => {
    const queue = new StreamingTtsQueue();
    const events: string[] = [];

    let releaseSecondSynth!: () => void;
    const secondSynthGate = new Promise<void>((r) => { releaseSecondSynth = r; });

    const synth = async (sentence: string): Promise<Blob | null> => {
      events.push(`synth_start:${sentence}`);
      if (sentence.includes("Drugie")) {
        await secondSynthGate;
      }
      events.push(`synth_done:${sentence}`);
      return new Blob([sentence], { type: "audio/mpeg" });
    };

    const play = async (blob: Blob): Promise<boolean> => {
      const txt = await blob.text();
      events.push(`play:${txt}`);
      if (txt.includes("Pierwsze")) {
        // W chwili gdy gra Pierwsze, synteza Drugiego już powinna być uruchomiona (lookahead)!
        expect(events).toContain("synth_start:Drugie zdanie.");
        releaseSecondSynth();
      }
      return true;
    };

    const ok = await queue.speak("Pierwsze zdanie. Drugie zdanie.", synth, play);
    expect(ok).toBe(true);
    expect(events.indexOf("play:Pierwsze zdanie.")).toBeLessThan(events.indexOf("synth_done:Drugie zdanie."));
    expect(events).toContain("play:Drugie zdanie.");
  });

  it("barge-in (cancel) przerywa AbortSignal i nie dopuszcza do nakładania dwóch wypowiedzi", async () => {
    const queue = new StreamingTtsQueue();
    const played: string[] = [];
    let aborted = false;

    const p1 = queue.speak(
      "Zdanie jeden. Zdanie dwa. Zdanie trzy.",
      async (s, signal) => {
        signal.addEventListener("abort", () => { aborted = true; });
        return new Blob([s]);
      },
      async (blob, signal) => {
        const t = await blob.text();
        played.push(t);
        if (t === "Zdanie jeden.") {
          // Użytkownik przerywa w trakcie zdania #1
          queue.cancel();
        }
        return !signal.aborted;
      },
    );

    await p1;
    expect(aborted).toBe(true);
    expect(played).toEqual(["Zdanie jeden."]);
    expect(queue.isActive).toBe(false);
  });

  it("zwraca false gdy pierwszy chunk padnie (sygnał do automatycznego fallbacku na natywny TTS)", async () => {
    const queue = new StreamingTtsQueue();
    const ok = await queue.speak(
      "Brak sieci test.",
      async () => null,
      async () => true,
    );
    expect(ok).toBe(false);
  });

  it("buduje poprawne zapytania dla ElevenLabs Flash v2.5, OpenAI gpt-4o-mini-tts oraz Modal Voice", async () => {
    const fakeBlob = new Blob(["audio"], { type: "audio/mpeg" });
    const fetchMock = vi.fn(async () => new Response(fakeBlob, { status: 200 }));

    await synthesizeElevenLabsChunk("Cześć, sprawdzam status.", {
      apiKey: "el_test",
      voiceId: "voice123",
      modelId: "eleven_flash_v2_5",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v1/text-to-speech/voice123/stream?optimize_streaming_latency=3");
    const elBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(elBody.model_id).toBe("eleven_flash_v2_5");
    expect(elBody.language_code).toBe("pl");

    await synthesizeOpenAiTtsChunk("Gotowe, zadanie zamknięte.", {
      apiKey: "oa_test",
      model: "gpt-4o-mini-tts",
      voice: "onyx",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.openai.com/v1/audio/speech");
    const oaBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(oaBody.model).toBe("gpt-4o-mini-tts");
    expect(oaBody.voice).toBe("onyx");

    await synthesizeModalVoiceTtsChunk("Mówię z Modala.", {
      modalVoiceUrl: "https://example--jarvis-voice.modal.run/",
      apiKey: "jvllm_test",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(String(fetchMock.mock.calls[2][0])).toBe("https://example--jarvis-voice.modal.run/v1/tts");
    const mvHeaders = (fetchMock.mock.calls[2][1] as RequestInit).headers as Record<string, string>;
    expect(mvHeaders.authorization).toBe("Bearer jvllm_test");
  });

  it("rozpoznaje nowe tryby głosu openai i modal w resolveVoiceMode i activeVoiceLabel", () => {
    const base = { speak: true, keys: { modal: "k" }, openaiTtsApiKey: "sk-x", openaiTtsModel: "gpt-4o-mini-tts", modalVoiceUrl: "https://v.modal.run" } as unknown as Settings;
    expect(resolveVoiceMode({ ...base, voiceMode: "openai" })).toBe("openai");
    expect(activeVoiceLabel({ ...base, voiceMode: "openai" })).toContain("OpenAI TTS");
    expect(resolveVoiceMode({ ...base, voiceMode: "modal" })).toBe("modal");
    expect(activeVoiceLabel({ ...base, voiceMode: "modal" })).toContain("Modal Voice");
  });
});
