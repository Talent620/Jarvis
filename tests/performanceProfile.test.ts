import { describe, it, expect } from "vitest";
import { detectLowPower } from "../src/lib/performanceProfile";

describe("performanceProfile — detectLowPower (konserwatywnie)", () => {
  it("typowe urządzenie (8 GB / 8 rdzeni) → pełne efekty", () => {
    expect(detectLowPower({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
  });

  it("brak danych → NIE włącza low-power (nie psuje typowych telefonów)", () => {
    expect(detectLowPower({})).toBe(false);
  });

  it("mała pamięć (≤2 GB) → low-power", () => {
    expect(detectLowPower({ deviceMemory: 2 })).toBe(true);
    expect(detectLowPower({ deviceMemory: 1 })).toBe(true);
    expect(detectLowPower({ deviceMemory: 0.5 })).toBe(true);
  });

  it("mało rdzeni (≤2) → low-power", () => {
    expect(detectLowPower({ hardwareConcurrency: 2 })).toBe(true);
    expect(detectLowPower({ hardwareConcurrency: 4 })).toBe(false);
  });

  it("reduced-motion lub save-data → low-power", () => {
    expect(detectLowPower({ deviceMemory: 8, reducedMotion: true })).toBe(true);
    expect(detectLowPower({ deviceMemory: 8, saveData: true })).toBe(true);
  });

  it("deviceMemory=0 (nieznane) nie wyzwala low-power", () => {
    expect(detectLowPower({ deviceMemory: 0 })).toBe(false);
  });
});
