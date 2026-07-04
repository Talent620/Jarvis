// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { isDesktop, isSpeechSupported, createListener, Listener } from "../src/lib/voice";
import { WhisperListener } from "../src/lib/whisperListener";

// Czyść globalne atrapy po każdym teście, by nie przeciekały między przypadkami.
afterEach(() => {
  delete (window as any).jarvisDesktop;
  delete (window as any).MediaRecorder;
  delete (window as any).webkitSpeechRecognition;
  delete (window as any).SpeechRecognition;
});

function fakeMediaRecorder() {
  (window as any).MediaRecorder = function () {};
  (navigator as any).mediaDevices = { getUserMedia: () => Promise.resolve({}) };
}

describe("wybór silnika mowy wg platformy", () => {
  it("isDesktop wykrywa Electrona po moście jarvisDesktop", () => {
    expect(isDesktop()).toBe(false);
    (window as any).jarvisDesktop = { platform: "win32" };
    expect(isDesktop()).toBe(true);
  });

  it("na desktopie obsługa mowy zależy od nagrywania (Whisper), nie od Web Speech", () => {
    (window as any).jarvisDesktop = { platform: "win32" };
    // Brak MediaRecorder → brak obsługi, mimo że Web Speech „niby" istnieje.
    (window as any).webkitSpeechRecognition = function () {};
    expect(isSpeechSupported()).toBe(false);
    fakeMediaRecorder();
    expect(isSpeechSupported()).toBe(true);
  });

  it("w przeglądarce/telefonie liczy się Web Speech", () => {
    expect(isSpeechSupported()).toBe(false);
    (window as any).webkitSpeechRecognition = function () {};
    expect(isSpeechSupported()).toBe(true);
  });

  it("createListener: desktop → WhisperListener, inaczej → Listener (Web Speech)", () => {
    (window as any).webkitSpeechRecognition = function () {};
    expect(createListener({ onFinal: () => {} })).toBeInstanceOf(Listener);

    (window as any).jarvisDesktop = { platform: "win32" };
    fakeMediaRecorder();
    expect(createListener({ onFinal: () => {} })).toBeInstanceOf(WhisperListener);
  });

  it("WhisperListener bez klucza Groq zgłasza błąd i nie zawiesza mikrofonu", () => {
    let err = "";
    let ended = false;
    const wl = new WhisperListener({ onFinal: () => {}, onError: (m) => (err = m), onEnd: () => (ended = true) });
    wl.start("pl-PL"); // brak klucza Groq w teście → krótka, czysta ścieżka błędu
    expect(err).toMatch(/Groq/);
    expect(ended).toBe(true);
    expect(wl.listening).toBe(false);
  });
});
