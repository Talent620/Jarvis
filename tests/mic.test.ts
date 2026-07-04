import { describe, it, expect, afterEach } from "vitest";
import { micAudioConstraints, listMics, ensureMicPermission } from "../src/lib/mic";
import { store } from "../src/lib/store";

afterEach(() => store.setSettings({ micDeviceId: "" }));

describe("micAudioConstraints — przypinanie wybranego mikrofonu", () => {
  it("bez wyboru zwraca bazę bez zmian (zgodność wsteczna: audio:true)", () => {
    store.setSettings({ micDeviceId: "" });
    expect(micAudioConstraints(true)).toBe(true);
  });

  it("bez wyboru zwraca bazowy obiekt ograniczeń nietknięty", () => {
    store.setSettings({ micDeviceId: "" });
    const base = { channelCount: 1, echoCancellation: true };
    expect(micAudioConstraints(base)).toEqual(base);
  });

  it("z wyborem dokłada deviceId:{ideal} do audio:true", () => {
    store.setSettings({ micDeviceId: "bt600" });
    expect(micAudioConstraints(true)).toEqual({ deviceId: { ideal: "bt600" } });
  });

  it("z wyborem łączy deviceId z istniejącymi ograniczeniami (nie gubi ich)", () => {
    store.setSettings({ micDeviceId: "bt600" });
    const out = micAudioConstraints({ channelCount: 1, noiseSuppression: true });
    expect(out).toEqual({ channelCount: 1, noiseSuppression: true, deviceId: { ideal: "bt600" } });
  });

  it("używa 'ideal' (a nie 'exact') — płynny fallback gdy słuchawki odłączone", () => {
    store.setSettings({ micDeviceId: "bt600" });
    const out = micAudioConstraints(true) as MediaTrackConstraints;
    expect(out.deviceId).toHaveProperty("ideal");
    expect(out.deviceId).not.toHaveProperty("exact");
  });

  it("nie mutuje przekazanego obiektu bazowego", () => {
    store.setSettings({ micDeviceId: "bt600" });
    const base = { channelCount: 1 } as MediaTrackConstraints;
    micAudioConstraints(base);
    expect(base).toEqual({ channelCount: 1 });
  });
});

describe("listMics / ensureMicPermission — bezpieczne bez API mediów", () => {
  it("listMics zwraca [] gdy brak navigator.mediaDevices (środowisko node)", async () => {
    await expect(listMics()).resolves.toEqual([]);
  });

  it("ensureMicPermission zwraca false gdy brak getUserMedia", async () => {
    await expect(ensureMicPermission()).resolves.toBe(false);
  });
});
