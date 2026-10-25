// B-034: the "Sterowanie komputerem głosem" switch. The controller holds the microphone through
// the app's voice arbiter, reports honest states and never leaves a session running after a stop.
import { describe, it, expect } from "vitest";
import { VoiceControl, type VoiceControlStatus } from "../../src/lib/runtime/voiceControl";
import { acquireVoice, currentVoiceOwner, releaseVoice } from "../../src/lib/voiceSession";
import { voiceLine } from "../../src/components/RuntimeStatusPanel";

function fakeStart(o: { fail?: string; delayMs?: number } = {}) {
  const sessions: { stopped: boolean }[] = [];
  let name = "deepgram-nova-3";
  const start = async () => {
    if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
    if (o.fail) throw new Error(o.fail);
    const s = { stopped: false };
    sessions.push(s);
    return { recognizer: () => name, stop: async () => { s.stopped = true; } };
  };
  return { start, sessions, fallback: (n: string) => { name = n; } };
}

describe("voice control switch", () => {
  it("starts once, holds the microphone, stops and releases it", async () => {
    const f = fakeStart();
    const vc = new VoiceControl({ start: f.start, acquire: acquireVoice, release: releaseVoice });
    const seen: VoiceControlStatus["state"][] = [];
    vc.subscribe((s) => seen.push(s.state));
    await Promise.all([vc.start(), vc.start()]);
    expect(f.sessions).toHaveLength(1);
    expect(vc.current).toEqual({ state: "listening", recognizer: "deepgram-nova-3" });
    expect(currentVoiceOwner()).toBe("computer");
    await vc.stop();
    expect(f.sessions[0].stopped).toBe(true);
    expect(currentVoiceOwner()).toBeNull();
    expect(seen).toEqual(["starting", "listening", "off"]);
  });

  it("another voice mode taking the microphone stops the session, says so, and a retry works", async () => {
    const f = fakeStart();
    const vc = new VoiceControl({ start: f.start, acquire: acquireVoice, release: releaseVoice });
    await vc.start();
    acquireVoice("main");
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sessions[0].stopped).toBe(true);
    expect(vc.current).toEqual({ state: "error", message: "mikrofon przejął inny tryb głosowy" });
    expect(voiceLine(vc.current)).toBe("nie działa: mikrofon przejął inny tryb głosowy");
    expect(currentVoiceOwner()).toBe("main");
    await vc.start(); // "Słuchaj ponownie"
    expect(vc.current.state).toBe("listening");
    expect(currentVoiceOwner()).toBe("computer");
    await vc.stop();
  });

  it("the recognizer name is live, and a fatal recognizer error ends listening visibly", async () => {
    const f = fakeStart();
    const vc = new VoiceControl({ start: f.start, acquire: acquireVoice, release: releaseVoice });
    await vc.start();
    f.fallback("groq-whisper");
    expect(vc.current).toEqual({ state: "listening", recognizer: "groq-whisper" });
    vc.report({ type: "stt_error", error: "all recognizers failed", fatal: false });
    expect(vc.current.state).toBe("listening");
    vc.report({ type: "stt_error", error: "all recognizers failed", fatal: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(vc.current).toEqual({ state: "error", message: "all recognizers failed" });
    expect(f.sessions[0].stopped).toBe(true);
    expect(currentVoiceOwner()).toBeNull();
  });

  it("no microphone: an error state the panel shows, the microphone is released", async () => {
    const vc = new VoiceControl({ start: fakeStart({ fail: "Permission denied" }).start, acquire: acquireVoice, release: releaseVoice });
    await vc.start();
    expect(vc.current).toEqual({ state: "error", message: "Permission denied" });
    expect(currentVoiceOwner()).toBeNull();
    expect(voiceLine(vc.current)).toBe("nie działa: Permission denied");
    await vc.stop();
    expect(voiceLine(vc.current)).toBeNull();
  });

  it("switched off while still starting: the late session is stopped at once", async () => {
    const f = fakeStart({ delayMs: 30 });
    const vc = new VoiceControl({ start: f.start, acquire: acquireVoice, release: releaseVoice });
    const p = vc.start();
    await vc.stop();
    await p;
    expect(f.sessions).toHaveLength(1);
    expect(f.sessions[0].stopped).toBe(true);
    expect(vc.current.state).toBe("off");
    expect(currentVoiceOwner()).toBeNull();
  });

  it("the panel line says how to talk to it", () => {
    expect(voiceLine({ state: "listening", recognizer: "groq-whisper" })).toBe("słucham (groq-whisper); zacznij od „Jarvis\"");
    expect(voiceLine({ state: "starting" })).toBe("włączam mikrofon");
    expect(voiceLine(null)).toBeNull();
  });
});
