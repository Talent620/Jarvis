// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { geminiSpeak, TTS_VOICES } from "../src/lib/voice";
import { store } from "../src/lib/store";

describe("głos premium tłumacza", () => {
  beforeEach(() => store.setSettings({ keys: { ...store.settings.keys, gemini: "" } }));

  it("TTS_VOICES ma głosy z czytelnymi opisami (kobiece i męskie)", () => {
    expect(TTS_VOICES.length).toBeGreaterThanOrEqual(5);
    expect(TTS_VOICES.find((v) => v.id === "Aoede")).toBeTruthy();
    for (const v of TTS_VOICES) expect(v.id && v.label).toBeTruthy();
  });

  it("geminiSpeak bez klucza Gemini grzecznie zwraca false (nie wybucha)", async () => {
    expect(await geminiSpeak("Привіт", "Aoede")).toBe(false);
    expect(await geminiSpeak("", "Aoede")).toBe(false);
  });
});
