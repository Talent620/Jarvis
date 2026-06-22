// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// STT niedostępne (brak Web Speech) + brak nagrywania → tor głosowy nie wstaje,
// ale tekstowy (say) musi działać. askJarvis zamockowany, by nie wołać sieci.
vi.mock("../src/lib/voice", () => ({
  createListener: () => ({ start: () => {}, stop: () => {}, listening: false }),
  speak: async () => {},
  stopSpeaking: () => {},
  isSpeechSupported: () => false,
}));
let reply = "OK, zrobione";
let throwOnce = false;
vi.mock("../src/lib/brain", () => ({
  askJarvis: async () => {
    if (throwOnce) { throwOnce = false; throw new Error("Chwilowy błąd sieci"); }
    return { text: reply };
  },
}));
vi.mock("../src/lib/store", () => ({ store: { settings: { speak: true } } }));

import { ConversationLoop } from "../src/lib/voiceLoop";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ConversationLoop — niezawodność (tor tekstowy + błędy)", () => {
  beforeEach(() => { reply = "OK, zrobione"; throwOnce = false; });

  it("bez STT start() zgłasza błąd, ale Szef działa tekstem (say)", async () => {
    const states: string[] = [];
    const caps: string[] = [];
    const loop = new ConversationLoop((s) => states.push(s), (t) => caps.push(t));
    loop.start(); // brak STT → error, ale nie crash
    expect(states).toContain("error");
    loop.say("która godzina");
    await flush();
    expect(caps).toContain("OK, zrobione"); // odpowiedział mimo braku mowy
    loop.stop();
  });

  it("błąd mózgu jest zgłaszany (nie wysadza pętli) i kolejne polecenie znów działa", async () => {
    const states: string[] = [];
    const loop = new ConversationLoop((s) => states.push(s), () => {});
    throwOnce = true;
    loop.say("zrób coś");
    await flush();
    expect(states).toContain("error"); // błąd wypłynął
    loop.say("spróbuj ponownie");
    await flush();
    expect(states.filter((s) => s === "speaking").length).toBeGreaterThan(0); // odzyskał sprawność
    loop.stop();
  });

  it("po stop() say() nic nie robi (bez wywołań po zamknięciu)", async () => {
    const caps: string[] = [];
    const loop = new ConversationLoop(() => {}, (t) => caps.push(t));
    loop.stop();
    loop.say("za późno");
    await flush();
    expect(caps).toEqual([]);
  });
});
