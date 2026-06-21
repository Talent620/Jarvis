import { describe, it, expect, vi } from "vitest";

// Capacitor + plugin natywny: zaślep, by import modułu nie wymagał środowiska natywnego.
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: {} }));

import { timerMs } from "../src/lib/notifications";

describe("notifications — timerMs (bezpieczne minuty minutnika)", () => {
  it("poprawne minuty → ms", () => {
    expect(timerMs(5)).toBe(300_000);
    expect(timerMs(1)).toBe(60_000);
  });
  it("0 / NaN / UJEMNE → domyślnie 1 min (nie 6 s jak w buggy Number||)", () => {
    expect(timerMs(0)).toBe(60_000);
    expect(timerMs(NaN)).toBe(60_000);
    expect(timerMs(-5)).toBe(60_000); // wcześniej dawało 6 s (Number(-5)||1 = -5 → max(0.1,-5))
    expect(timerMs(-0.5)).toBe(60_000);
  });
  it("drobny dodatni → podłoga 0.1 min (6 s)", () => {
    expect(timerMs(0.05)).toBe(6_000);
  });
  it("ogromny → przycięty do ~24 dni (anty-przepełnienie setTimeout)", () => {
    expect(timerMs(1_000_000)).toBe(2_147_483_647);
  });
});
