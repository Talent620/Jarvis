// Streaming STT adapters on scripted provider protocol streams (tests/fixtures/voice), the batch
// fallback with a turn detector, the fallback chain, and the provider catalog.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BatchSTT, DeepgramSTT, FallbackSTT, OpenAiRealtimeSTT, TurnDetector, deepgramParser, openAiRealtimeParser } from "../../src/lib/runtime/voice/adapters";
import { VOICE_CATALOG, providerChain, resolveLiveModel, sttChain, liveResource } from "../../src/lib/runtime/voice/catalog";
import type { SttEvent } from "../../src/lib/runtime/voice/types";
import { ScriptedSTT, fakeConnect } from "../helpers/voice";

const stream = (name: string) => readFileSync(`tests/fixtures/voice/${name}`, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
const finals = (ev: SttEvent[]) => ev.filter((e) => e.type === "final").map((e) => (e as { text: string }).text);

describe("Deepgram live protocol", () => {
  it("replays the golden utterances: growing partials, one final per utterance", () => {
    const ev: SttEvent[] = [];
    let id = 0;
    const parse = deepgramParser((e) => ev.push(e), () => 1, () => `u${++id}`);
    for (const m of stream("deepgram-golden.jsonl")) parse(m);
    expect(finals(ev)).toEqual([
      "Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "Zjedź trochę niżej.", "Znajdź komentarze.",
      "Pierwszy komentarz.", "Zaznacz pierwsze cztery litery.", "Skopiuj.", "Wyślij to mailem Marcinowi.",
    ]);
    // Partials of one utterance share its id and only grow; the final closes it.
    const sel = ev.filter((e) => e.type !== "speech_start" && e.type !== "speech_end" && (e as { utteranceId: string }).utteranceId === "u7");
    const texts = sel.map((e) => (e as { text: string }).text);
    expect(texts[0]).toBe("Zaznacz");
    expect(texts.at(-1)).toBe("Zaznacz pierwsze cztery litery.");
    expect(sel.at(-1)!.type).toBe("final");
    expect(ev.filter((e) => e.type === "speech_start")).toHaveLength(9);
  });

  it("UtteranceEnd closes an utterance that never got speech_final", () => {
    const ev: SttEvent[] = [];
    const parse = deepgramParser((e) => ev.push(e), () => 1);
    parse({ type: "Results", is_final: true, speech_final: false, channel: { alternatives: [{ transcript: "zjedź niżej", confidence: 0.9 }] } });
    expect(finals(ev)).toEqual([]);
    parse({ type: "UtteranceEnd" });
    expect(finals(ev)).toEqual(["zjedź niżej"]);
    parse({ type: "UtteranceEnd" }); // nothing pending: no empty final
    expect(finals(ev)).toHaveLength(1);
  });

  it("socket adapter: Polish nova-3 URL, caller's auth subprotocol, audio buffered until open, CloseStream on stop", async () => {
    const { connect, sockets } = fakeConnect();
    const stt = new DeepgramSTT({ connect, protocols: ["token", "KEY-FROM-SETTINGS"] });
    const ev: SttEvent[] = [];
    await stt.start((e) => ev.push(e));
    const s = sockets[0];
    const url = new URL(s.url);
    expect(url.host).toBe("api.deepgram.com");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ model: "nova-3", language: "pl", interim_results: "true", encoding: "linear16", sample_rate: "16000" });
    expect(s.protocols).toEqual(["token", "KEY-FROM-SETTINGS"]);
    stt.pushAudio(new ArrayBuffer(640));
    expect(s.sent).toHaveLength(0);
    s.open();
    expect(s.sent).toHaveLength(1);
    s.deliver({ type: "Results", is_final: true, speech_final: true, channel: { alternatives: [{ transcript: "stop", confidence: 0.95 }] } });
    expect(finals(ev)).toEqual(["stop"]);
    await stt.stop();
    expect(s.sent.at(-1)).toBe(JSON.stringify({ type: "CloseStream" }));
    expect(s.closed?.code).toBe(1000);
  });

  it("an unexpected close is a fatal error (the chain moves on), a requested stop is not", async () => {
    const { connect, sockets } = fakeConnect();
    const stt = new DeepgramSTT({ connect, protocols: [] });
    const ev: SttEvent[] = [];
    await stt.start((e) => ev.push(e));
    sockets[0].open();
    sockets[0].drop(1011);
    expect(ev.at(-1)).toMatchObject({ type: "error", fatal: true });
  });
});

describe("OpenAI Realtime transcription protocol", () => {
  it("deltas grow a partial per item, completed is the final, errors are reported", () => {
    const ev: SttEvent[] = [];
    const parse = openAiRealtimeParser((e) => ev.push(e), () => 1);
    for (const m of stream("openai-realtime.jsonl")) parse(m);
    expect(finals(ev)).toEqual(["Zaznacz pierwsze cztery litery.", "Skopiuj."]);
    const partials = ev.filter((e) => e.type === "partial" && e.utteranceId === "oa-item_001").map((e) => (e as { text: string }).text);
    expect(partials).toEqual(["Zaznacz", "Zaznacz pierwsze", "Zaznacz pierwsze cztery", "Zaznacz pierwsze cztery litery."]);
    expect(ev.at(-1)).toMatchObject({ type: "error", fatal: false });
  });

  it("socket adapter configures a Polish transcription session and sends base64 PCM", async () => {
    const { connect, sockets } = fakeConnect();
    const stt = new OpenAiRealtimeSTT({ connect, protocols: ["realtime"] });
    await stt.start(() => undefined);
    const s = sockets[0];
    expect(s.url).toBe("wss://api.openai.com/v1/realtime?intent=transcription");
    s.open();
    const setup = JSON.parse(String(s.sent[0]));
    expect(setup).toMatchObject({ type: "transcription_session.update", session: { input_audio_format: "pcm16", input_audio_transcription: { model: "gpt-4o-transcribe", language: "pl" } } });
    stt.pushAudio(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(JSON.parse(String(s.sent[1]))).toEqual({ type: "input_audio_buffer.append", audio: "AQIDBA==" });
  });
});

describe("batch fallback (Whisper) and the turn detector", () => {
  const frame = (amp: number) => { const a = new Int16Array(320); a.fill(amp); return a.buffer; };

  it("one final per turn, no partials", async () => {
    const heard: number[] = [];
    const stt = new BatchSTT({ transcribe: async (frames) => { heard.push(frames.length); return "skopiuj"; }, turn: new TurnDetector({ minSpeechMs: 60, silenceMs: 100 }) });
    const ev: SttEvent[] = [];
    await stt.start((e) => ev.push(e));
    for (let i = 0; i < 10; i++) stt.pushAudio(frame(8000));
    for (let i = 0; i < 6; i++) stt.pushAudio(frame(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(ev.map((e) => e.type)).toEqual(["speech_start", "speech_end", "final"]);
    expect(finals(ev)).toEqual(["skopiuj"]);
    expect(heard[0]).toBeGreaterThan(5);
  });

  it("silence alone never produces a turn", () => {
    const t = new TurnDetector();
    for (let i = 0; i < 200; i++) expect(t.push(frame(10))).toBeNull();
  });
});

describe("fallback chain", () => {
  it("a recognizer that fails to start or dies mid-session hands over to the next, reported", async () => {
    const a = new ScriptedSTT("deepgram-nova-3", true);
    const b = new ScriptedSTT("openai-realtime-transcribe");
    const c = new ScriptedSTT("groq-whisper");
    const switches: string[] = [];
    const chain = new FallbackSTT([() => a, () => b, () => c], (from, reason) => switches.push(`${from}: ${reason}`));
    const ev: SttEvent[] = [];
    await chain.start((e) => ev.push(e));
    expect(chain.id).toBe("openai-realtime-transcribe");
    b.emit({ type: "final", utteranceId: "x", text: "stop", confidence: 1, at: 1 });
    b.emit({ type: "error", error: "closed (1011)", fatal: true, at: 2 });
    await new Promise((r) => setTimeout(r, 0));
    expect(chain.id).toBe("groq-whisper");
    b.emit({ type: "final", utteranceId: "late", text: "ghost", confidence: 1, at: 3 }); // replaced: ignored
    c.emit({ type: "final", utteranceId: "y", text: "dalej", confidence: 1, at: 4 });
    expect(finals(ev)).toEqual(["stop", "dalej"]);
    expect(switches).toEqual(["deepgram-nova-3: deepgram-nova-3 unavailable", "openai-realtime-transcribe: closed (1011)"]);
    expect(b.stopped).toBe(true);
  });
});

describe("voice provider catalog", () => {
  it("has at least two streaming recognizers with Polish plus the Whisper fallback", () => {
    const streaming = VOICE_CATALOG.filter((e) => e.role === "stt_streaming" && e.polish && e.partials && e.vendor !== "browser");
    expect(streaming.length).toBeGreaterThanOrEqual(2);
    expect(VOICE_CATALOG.some((e) => e.id === "groq-whisper" && e.status === "fallback")).toBe(true);
  });

  it("the dead Gemini Live id is never chosen; stored dead ids map to the default live model", () => {
    const chain = providerChain("live_conversation", () => true);
    expect(chain.map((e) => e.model)).not.toContain("gemini-2.0-flash-live-001");
    expect(chain[0]).toMatchObject({ model: "gemini-3.8-live", functionCalling: "NON_BLOCKING" });
    expect(liveResource(resolveLiveModel("models/gemini-2.0-flash-live-001"))).toBe("models/gemini-3.8-live");
    expect(resolveLiveModel("models/gemini-2.5-flash-preview-native-audio-dialog").id).toBe("gemini-live-native-audio");
  });

  it("the STT chain follows the keys the user has: streaming first, Whisper last", () => {
    expect(sttChain(() => true).map((e) => e.id)).toEqual(["deepgram-nova-3", "openai-realtime-transcribe", "groq-whisper"]);
    expect(sttChain((c) => c === "groq").map((e) => e.id)).toEqual(["groq-whisper"]);
    expect(sttChain(() => false, { browserSpeech: true }).map((e) => e.id)).toEqual(["browser-web-speech"]);
  });

  it("unverified ids say where they come from", () => {
    for (const e of VOICE_CATALOG.filter((x) => !x.verified)) expect(e.source.length).toBeGreaterThan(10);
  });
});
