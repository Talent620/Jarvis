import { describe, it, expect } from "vitest";
import { isHeadsetLabel } from "../src/lib/headset";

describe("Voice-first — wykrywanie słuchawek BT po etykiecie", () => {
  it("rozpoznaje popularne zestawy", () => {
    expect(isHeadsetLabel("AirPods Pro")).toBe(true);
    expect(isHeadsetLabel("Galaxy Buds2 Pro")).toBe(true);
    expect(isHeadsetLabel("Sony WH-1000XM5 Hands-Free AG Audio")).toBe(true);
    expect(isHeadsetLabel("Bluetooth Headset (JBL)")).toBe(true);
    expect(isHeadsetLabel("Słuchawki Edifier")).toBe(true);
  });

  it("nie reaguje na wbudowane mikrofony/głośniki", () => {
    expect(isHeadsetLabel("Default - Microphone Array (Realtek)")).toBe(false);
    expect(isHeadsetLabel("Speakers (High Definition Audio)")).toBe(false);
    expect(isHeadsetLabel("Wbudowany mikrofon")).toBe(false);
  });

  it("pusta/brakująca etykieta → false (bez uprawnień brak fałszywych alarmów)", () => {
    expect(isHeadsetLabel("")).toBe(false);
    expect(isHeadsetLabel(undefined as unknown as string)).toBe(false);
  });
});
