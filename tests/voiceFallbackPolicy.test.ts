// === Polityka głosu przy awarii (voiceFallbackPolicy) — testy ===
// Awaria wybranego głosu (premium/local) NIE może po cichu włączać systemowego. Domyślnie „ask":
// pytamy i NIE zmieniamy głosu. „system" albo jednorazowa zgoda → wolno użyć systemowego.
import { describe, it, expect } from "vitest";
import { voiceFallbackDecision } from "../src/lib/voice";

describe("voiceFallbackDecision", () => {
  it("gdy premium NIE padło (np. tryb systemowy) → zawsze play_system", () => {
    expect(voiceFallbackDecision({ premiumFailed: false })).toBe("play_system");
    expect(voiceFallbackDecision({ premiumFailed: false, policy: "ask" })).toBe("play_system");
  });

  it("domyślnie (brak polityki) awaria premium → notify (bez cichej zmiany)", () => {
    expect(voiceFallbackDecision({ premiumFailed: true })).toBe("notify");
  });

  it("polityka ask → notify; polityka system → play_system", () => {
    expect(voiceFallbackDecision({ premiumFailed: true, policy: "ask" })).toBe("notify");
    expect(voiceFallbackDecision({ premiumFailed: true, policy: "system" })).toBe("play_system");
  });

  it("jednorazowa zgoda (systemOverride) → play_system nawet przy polityce ask", () => {
    expect(voiceFallbackDecision({ premiumFailed: true, policy: "ask", systemOverride: true })).toBe("play_system");
  });
});
