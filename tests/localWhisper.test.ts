import { describe, it, expect } from "vitest";
import { localSttSupported, localSttUsable, transcribeLocal, WHISPER_MODEL } from "../src/lib/localWhisper";

describe("localWhisper — capability-check (środowisko bez AudioContext)", () => {
  it("niewspierane bez AudioContext (node) → false", () => {
    // node nie ma AudioContext/OfflineAudioContext → STT on-device niedostępne.
    expect(localSttSupported()).toBe(false);
    expect(localSttUsable()).toBe(false);
  });

  it("transcribeLocal zwraca null, gdy niewspierane (caller spada do chmury)", async () => {
    expect(await transcribeLocal(new Blob(["x"]))).toBeNull();
  });

  it("eksponuje wybrany model Whisper", () => {
    expect(WHISPER_MODEL).toContain("whisper");
  });
});
