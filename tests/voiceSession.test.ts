import { describe, it, expect, beforeEach } from "vitest";
import { acquireVoice, releaseVoice, currentVoiceOwner, onVoiceOwnerChange } from "../src/lib/voiceSession";

beforeEach(() => {
  // wyzeruj stan między testami
  releaseVoice("main"); releaseVoice("headset"); releaseVoice("live"); releaseVoice("boss"); releaseVoice("permission");
});

describe("voiceSession — jeden właściciel mikrofonu", () => {
  it("przejęcie ustawia właściciela", () => {
    acquireVoice("main");
    expect(currentVoiceOwner()).toBe("main");
  });

  it("nowy właściciel PREEMPTUJE poprzedniego (woła jego release)", () => {
    let mainStopped = false;
    acquireVoice("main", () => { mainStopped = true; });
    acquireVoice("headset");
    expect(mainStopped).toBe(true); // główny mikrofon zatrzymany
    expect(currentVoiceOwner()).toBe("headset");
  });

  it("release tylko od aktualnego właściciela działa", () => {
    acquireVoice("headset");
    releaseVoice("main"); // nie jest właścicielem → no-op
    expect(currentVoiceOwner()).toBe("headset");
    releaseVoice("headset");
    expect(currentVoiceOwner()).toBeNull();
  });

  it("ponowne przejęcie przez tego samego właściciela nie woła release", () => {
    let releases = 0;
    acquireVoice("main", () => { releases++; });
    acquireVoice("main", () => { releases++; });
    expect(releases).toBe(0);
    expect(currentVoiceOwner()).toBe("main");
  });

  it("subskrybenci dostają zmianę właściciela; błąd jednego nie blokuje reszty", () => {
    const seen: (string | null)[] = [];
    const offBad = onVoiceOwnerChange(() => { throw new Error("zły"); });
    const off = onVoiceOwnerChange((o) => seen.push(o));
    acquireVoice("live");
    releaseVoice("live");
    expect(seen).toEqual(["live", null]);
    offBad(); off();
  });
});
