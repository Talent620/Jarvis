// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { geminiSpeak, TTS_VOICES, bestPlVoiceName, voiceQualityScore, checkPinnedVoice, activeVoiceLabel } from "../src/lib/voice";
import { store } from "../src/lib/store";
import type { Settings } from "../src/types";

const baseVoice = () => ({ ...store.settings, speak: true, localTts: false, fishAudioApiKey: "", fishAudioVoiceId: "", elevenLabsApiKey: "", elevenLabsVoiceId: "", geminiTts: false, voicePinned: false, voiceSystemPl: true, voiceName: "", keys: { ...store.settings.keys, gemini: "" } }) as Settings;

describe("activeVoiceLabel — jasny status aktywnego głosu (koniec chaosu)", () => {
  it("mowa wyłączona → 🔇", () => {
    expect(activeVoiceLabel({ ...baseVoice(), speak: false })).toMatch(/wyłączony/);
  });
  it("prosty polski + wybrany głos → pokazuje nazwę głosu", () => {
    expect(activeVoiceLabel({ ...baseVoice(), voiceName: "Zofia" })).toMatch(/Zofia/);
  });
  it("przypięty głos → dopisek „przypięty”", () => {
    expect(activeVoiceLabel({ ...baseVoice(), voiceName: "Marek", voicePinned: true })).toMatch(/przypięty/);
  });
  it("ElevenLabs liczy się TYLKO gdy nie wymuszamy prostego PL (priorytety jak w speak)", () => {
    const withKey = { ...baseVoice(), elevenLabsApiKey: "K", elevenLabsVoiceId: "V" };
    expect(activeVoiceLabel({ ...withKey, voiceSystemPl: true })).not.toMatch(/ElevenLabs/); // prosty PL wygrywa
    expect(activeVoiceLabel({ ...withKey, voiceSystemPl: false })).toMatch(/ElevenLabs/);
  });
  it("Fish Audio ma priorytet nad torem systemowym (jak w speak)", () => {
    expect(activeVoiceLabel({ ...baseVoice(), fishAudioApiKey: "K", fishAudioVoiceId: "V" })).toMatch(/Fish/);
  });
});

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

describe("bestPlVoiceName — stały, najlepszy polski głos", () => {
  it("preferuje polski głos o najwyższej jakości / sieciowy / Google", () => {
    const name = bestPlVoiceName([
      { name: "en-us-x-iol-local", lang: "en-US", quality: 400 },
      { name: "pl-pl-x-oda-local", lang: "pl-PL", quality: 300, network: false },
      { name: "pl-pl-x-oda-network", lang: "pl-PL", quality: 400, network: true },
    ]);
    expect(name).toBe("pl-pl-x-oda-network");
  });
  it("brak polskich głosów → pusty wybór (zostaje domyślny)", () => {
    expect(bestPlVoiceName([{ name: "en-US-Daniel", lang: "en-US", quality: 500 }])).toBe("");
    expect(bestPlVoiceName([])).toBe("");
  });
  it("voiceQualityScore premiuje sieciowy/Google/jakość", () => {
    const net = voiceQualityScore({ name: "pl-pl-x-oda-network", lang: "pl-PL", quality: 400, network: true });
    const loc = voiceQualityScore({ name: "pl-pl-x-oda-local", lang: "pl-PL", quality: 300, network: false });
    expect(net).toBeGreaterThan(loc);
  });
});

describe("checkPinnedVoice — Voice Guardian na starcie", () => {
  it("brak przypiętego głosu → nic nie zmienia", async () => {
    store.setSettings({ voiceName: "" });
    const r = await checkPinnedVoice();
    expect(r.changed).toBe(false);
  });
});
