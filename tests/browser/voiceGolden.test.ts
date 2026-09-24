// Golden scenario 1-8 driven by a streaming recognizer event stream through the voice session,
// on a real Chromium with the YouTube fixture and a mock Gmail. Speech output is a fake TTS;
// the numbers printed are runtime and browser latencies, not end-to-end audio latency.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime } from "../../src/lib/runtime/lanes/runtime";
import { VoiceSession } from "../../src/lib/runtime/voice/session";
import { ManagedBrowser } from "../../src/node/managedBrowser";
import { MockMail } from "../helpers/mockMail";
import { FakeTTS, ScriptedSTT, speakInto } from "../helpers/voice";
// @ts-expect-error plain ESM fixture without types
import { startYoutubeFixture } from "../fixtures/youtube/server.mjs";
import { findChromium } from "./chromium";

const until = async (cond: () => boolean, ms = 15_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("voice-driven golden scenario on Chromium", () => {
  it("steps 1-8 from recognizer events, one spoken consent, mail confirmed from Sent", async () => {
    const fixture = await startYoutubeFixture({ rerenderMs: 2000 });
    const profile = mkdtempSync(join(tmpdir(), "jarvis-voice-"));
    const browser = new ManagedBrowser({ userDataDir: profile, executablePath: findChromium(), headless: true });
    const stt = new ScriptedSTT();
    const tts = new FakeTTS(5);
    const voice = new VoiceSession({ stt, tts });
    const kernel = new Kernel();
    const mail = new MockMail();
    const rt = new JarvisRuntime({
      kernel, env: browser, speaker: voice,
      session: {
        youtubeUrl: `${fixture.url}/`, mail, mailOptions: { timeoutMs: 2000, recheckDelayMs: 50 },
        contacts: async () => [{ id: "m1", name: "Marcin Kubicki", emails: ["marcin.kubicki@example.com"], source: "fixture" }],
      },
    });
    voice.attach(rt);
    try {
      await rt.start();
      await voice.start();
      const at = () => Date.now();
      for (const l of ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "Zjedź trochę niżej.", "Znajdź komentarze.", "Pierwszy komentarz.", "Zaznacz pierwsze cztery litery.", "Skopiuj."]) {
        speakInto(stt, l, at);
        await rt.idle();
        await until(() => !voice.speaking);
      }
      speakInto(stt, "Wyślij to mailem Marcinowi.", at);
      await until(() => Object.keys(kernel.state.consents).length === 1);
      await until(() => !voice.speaking);
      speakInto(stt, "tak", at);
      await rt.idle();
      const actions = rt.turns.filter((t) => t.route === "action");
      expect(actions.map((t) => t.result?.truth), actions.map((t) => `${t.text} -> ${t.say}`).join("\n")).toEqual(Array(9).fill("CONFIRMED"));
      expect(mail.sent).toEqual([expect.objectContaining({ to: "marcin.kubicki@example.com", body: "Łódź" })]);
      const lat = voice.latency.summary();
      console.log(`voice golden on Chromium, latency ms: ${JSON.stringify(lat)}`);
      expect(lat.final_to_verified.count).toBe(9);
    } finally {
      await voice.stop();
      rt.stop();
      await browser.close();
      await fixture.close();
      rmSync(profile, { recursive: true, force: true });
    }
  }, 120_000);
});
