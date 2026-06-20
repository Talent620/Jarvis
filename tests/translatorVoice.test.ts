// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { geminiSpeak, TTS_VOICES, bestPlVoiceName, voiceQualityScore, checkPinnedVoice } from "../src/lib/voice";
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
