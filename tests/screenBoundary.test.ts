// === Granica ekranu i szkielet ładowania (screenBoundary) — testy ===
// Koniec „martwej pustki": Suspense pokazuje lekki szkielet z nazwą ekranu, a błąd oferuje Ponów i Wróć.
// Szkielet nie animuje się na słabym sprzęcie / przy „ogranicz ruch". Bez renderera React → skan źródła
// + czysty detektor mocy urządzenia.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { detectLowPower } from "../src/lib/performanceProfile";

const read = (p: string) => readFileSync(p, "utf8");

describe("ScreenBoundary — brak martwej pustki", () => {
  const src = read("src/components/ScreenBoundary.tsx");
  it("nie używa fallback={null} — pokazuje ScreenSkeleton", () => {
    expect(src).not.toMatch(/fallback=\{null\}/);
    expect(src).toMatch(/ScreenSkeleton/);
  });
  it("przekazuje onBack do granicy błędu", () => {
    expect(src).toMatch(/onBack=\{onBack\}/);
  });
});

describe("ScreenSkeleton — lekki, z nazwą, statyczny na słabym sprzęcie", () => {
  const src = read("src/components/ScreenSkeleton.tsx");
  it("pokazuje nazwę ładowanego ekranu", () => {
    expect(src).toMatch(/Otwieram/);
    expect(src).toMatch(/name/);
  });
  it("wyłącza migotanie na low-power (detectLowPower)", () => {
    expect(src).toMatch(/detectLowPower/);
    expect(src).toMatch(/skeleton-shimmer/);
  });
});

describe("ErrorBoundary — Ponów i Wróć", () => {
  const src = read("src/components/ErrorBoundary.tsx");
  it("ma przycisk Ponów (remount ekranu) i Wróć (onBack)", () => {
    expect(src).toMatch(/Ponów/);
    expect(src).toMatch(/Wróć/);
    expect(src).toMatch(/onBack/);
  });
});

describe("detectLowPower — ogranicz ruch traktujemy jak słaby sprzęt", () => {
  it("reducedMotion=true → low power (szkielet statyczny)", () => {
    expect(detectLowPower({ reducedMotion: true })).toBe(true);
  });
  it("mocne urządzenie → nie low power", () => {
    expect(detectLowPower({ reducedMotion: false, deviceMemoryGB: 8, hardwareConcurrency: 8 })).toBe(false);
  });
});
