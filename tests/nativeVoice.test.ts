// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";

// Natywna powłoka (Android/iOS APK): zaślep Capacitor jako platformę natywną.
// registerPlugin musi istnieć — voice.ts rejestruje NativeTTS przy imporcie modułu.
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
  registerPlugin: () => ({ speak: async () => {}, listVoices: async () => ({ voices: [] }), stop: async () => {} }),
}));

// Klucz Groq sterowany z testu (tor nagrywany włącza się tylko z kluczem).
let groq = "";
vi.mock("../src/lib/keys", () => ({ primaryKey: (p: string) => (p === "groq" ? groq : "") }));

import { isSpeechSupported, createListener, usesRecordedStt } from "../src/lib/voice";
import { WhisperListener } from "../src/lib/whisperListener";

afterEach(() => {
  groq = "";
  delete (window as any).MediaRecorder;
  delete (window as any).webkitSpeechRecognition;
  delete (window as any).SpeechRecognition;
});

function fakeMediaRecorder() {
  (window as any).MediaRecorder = function () {};
  (navigator as any).mediaDevices = { getUserMedia: () => Promise.resolve({}) };
}

describe("nasłuch na natywnym Androidzie/iOS (APK)", () => {
  it("z kluczem Groq + nagrywaniem → tor Whisper (Web Speech w WebView nie transkrybuje)", () => {
    fakeMediaRecorder();
    groq = "gsk_test";
    expect(usesRecordedStt()).toBe(true);
    expect(createListener({ onFinal: () => {} })).toBeInstanceOf(WhisperListener);
  });

  it("bez klucza Groq → DALEJ tor nagrywany (Web Speech nie działa w WebView APK; transkrypcja wybierze lokalny Whisper/Groq lub poda czytelny błąd)", () => {
    fakeMediaRecorder();
    (window as any).webkitSpeechRecognition = function () {}; // nawet gdyby „istniał", w APK i tak nie transkrybuje
    groq = "";
    expect(usesRecordedStt()).toBe(true);
    expect(createListener({ onFinal: () => {} })).toBeInstanceOf(WhisperListener);
  });

  it("obsługa mowy jest dostępna, gdy można nagrywać (Whisper) albo jest Web Speech", () => {
    expect(isSpeechSupported()).toBe(false); // ani nagrywania, ani Web Speech
    (window as any).webkitSpeechRecognition = function () {};
    expect(isSpeechSupported()).toBe(true); // jest Web Speech
    delete (window as any).webkitSpeechRecognition;
    fakeMediaRecorder();
    expect(isSpeechSupported()).toBe(true); // można nagrywać (Whisper)
  });
});

describe("WhisperListener — tryb ciągły (hands-free)", () => {
  it("continuous + bez słowa-klucza → po wypowiedzi NIE kończy nasłuchu", () => {
    const finals: string[] = [];
    let ended = false;
    const wl = new WhisperListener({
      onFinal: (t) => finals.push(t),
      onEnd: () => (ended = true),
      continuous: true,
    });
    // Dostań się do prywatnej obsługi transkryptu bez realnego mikrofonu/sieci.
    (wl as any).active = true;
    (wl as any).handleTranscript("która godzina");
    expect(finals).toEqual(["która godzina"]);
    expect(ended).toBe(false); // ciągły → słucha dalej
    expect(wl.listening).toBe(true);
  });

  it("bez continuous i bez słowa-klucza → kończy po jednej wypowiedzi", () => {
    const finals: string[] = [];
    let ended = false;
    const wl = new WhisperListener({ onFinal: (t) => finals.push(t), onEnd: () => (ended = true) });
    (wl as any).active = true;
    (wl as any).handleTranscript("dodaj zadanie");
    expect(finals).toEqual(["dodaj zadanie"]);
    expect(ended).toBe(true);
    expect(wl.listening).toBe(false);
  });
});
