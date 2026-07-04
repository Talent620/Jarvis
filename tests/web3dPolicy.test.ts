// === Adaptacyjny silnik 3D (web3dPolicy) — testy ===
// Wrażenie tak, grzejnik nie. Sprawdzamy: brak WebGL / reduced-motion / Save-Data → lekki fallback;
// REAL_3D na zdolnym urządzeniu → poster przed załadowaniem + lazy-load; AUTO nie odpala realnego 3D
// samo; S9 (słaby telefon) dostaje CSS 2.5D/poster; OFF wyłącza.
import { describe, it, expect } from "vitest";
import { resolve3D, canRunReal3D, THREE_D_PRESETS, WEB_VITALS_BUDGET, type DeviceCaps } from "../src/lib/web3dPolicy";

const strong: DeviceCaps = { webgl: true, deviceMemoryGB: 8, hardwareConcurrency: 8, reducedMotion: false, saveData: false, lowEndPhone: false };
const s9: DeviceCaps = { webgl: true, deviceMemoryGB: 3, hardwareConcurrency: 4, reducedMotion: false, saveData: false, lowEndPhone: true };

describe("web3dPolicy — zdolność do realnego 3D", () => {
  it("mocne urządzenie udźwignie; S9/brak WebGL/reduced-motion/Save-Data nie", () => {
    expect(canRunReal3D(strong)).toBe(true);
    expect(canRunReal3D(s9)).toBe(false);
    expect(canRunReal3D({ ...strong, webgl: false })).toBe(false);
    expect(canRunReal3D({ ...strong, reducedMotion: true })).toBe(false);
    expect(canRunReal3D({ ...strong, saveData: true })).toBe(false);
  });
});

describe("web3dPolicy — rozstrzyganie trybu", () => {
  it("REAL_3D na zdolnym → real, z posterem i lazy-load (nie blokuje LCP)", () => {
    const r = resolve3D("REAL_3D", strong);
    expect(r.effective).toBe("real");
    expect(r.poster).toBe(true);
    expect(r.lazyLoad).toBe(true);
    expect(r.fallback).toBe(true);
  });

  it("REAL_3D na S9 → lekki fallback CSS + poster (bez WebGL-owego obciążenia)", () => {
    const r = resolve3D("REAL_3D", s9);
    expect(r.effective).toBe("css");
    expect(r.poster).toBe(true);
  });

  it("brak WebGL → REAL_3D schodzi do CSS", () => {
    expect(resolve3D("REAL_3D", { ...strong, webgl: false }).effective).toBe("css");
  });

  it("reduced-motion / Save-Data → lekkie CSS niezależnie od żądania", () => {
    expect(resolve3D("REAL_3D", { ...strong, reducedMotion: true }).effective).toBe("css");
    expect(resolve3D("CSS_3D", { ...strong, saveData: true }).effective).toBe("css");
  });

  it("AUTO nie odpala realnego 3D samo z siebie", () => {
    expect(resolve3D("AUTO", strong).effective).toBe("css");
    expect(resolve3D("AUTO", s9).effective).toBe("css");
  });

  it("OFF wyłącza 3D", () => {
    expect(resolve3D("OFF", strong).effective).toBe("off");
  });
});

describe("web3dPolicy — presety i budżet", () => {
  it("każdy preset wspiera dotyk i reduced-motion", () => {
    expect(THREE_D_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(THREE_D_PRESETS.every((p) => p.supportsTouch && p.supportsReducedMotion)).toBe(true);
  });

  it("budżet Core Web Vitals jest ustawiony na cele web.dev", () => {
    expect(WEB_VITALS_BUDGET.lcpMs).toBe(2500);
    expect(WEB_VITALS_BUDGET.inpMs).toBe(200);
    expect(WEB_VITALS_BUDGET.cls).toBe(0.1);
  });
});
