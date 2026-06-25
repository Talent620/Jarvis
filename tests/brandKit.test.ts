// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { brandContextBlock, appendBrand, brandImageSuffix, hasBrandKit, loadBrandKit, saveBrandKit } from "../src/lib/brandKit";
import { store } from "../src/lib/store";
import type { BrandKit } from "../src/types";

const KIT: BrandKit = {
  name: "Lipa Cafe", tagline: "Kawa jak w domu", voice: "ciepły, ekspercki",
  colors: "brąz #5A3E2B, krem #F3E9DC", fonts: "nagłówki Playfair, tekst Inter",
  keywords: "rzemieślnicza, przytulna, naturalna", avoid: "tani, agresywny",
};

describe("brandKit — pamięć marki", () => {
  beforeEach(() => store.setSettings({ brandKit: undefined }));

  it("hasBrandKit: pusty → false, wypełniony → true", () => {
    expect(hasBrandKit({})).toBe(false);
    expect(hasBrandKit(KIT)).toBe(true);
  });

  it("save/load przez store", () => {
    saveBrandKit(KIT);
    expect(loadBrandKit().name).toBe("Lipa Cafe");
  });

  it("brandContextBlock zawiera ton, kolory, typografię i słowa kluczowe", () => {
    const b = brandContextBlock(KIT);
    expect(b).toMatch(/TOŻSAMOŚĆ MARKI/);
    expect(b).toMatch(/Ton głosu: ciepły, ekspercki/);
    expect(b).toMatch(/Kolory marki: brąz #5A3E2B/);
    expect(b).toMatch(/Typografia: nagłówki Playfair/);
    expect(b).toMatch(/Czego unikać: tani, agresywny/);
  });

  it("pusty kit → blok pusty (zero wpływu)", () => {
    expect(brandContextBlock({})).toBe("");
  });
});

describe("appendBrand — wstrzykiwanie do generatorów (rozszerzenie, nie nadpisanie)", () => {
  it("dokleja blok marki do system-promptu, zachowując bazę", () => {
    const out = appendBrand("BAZOWY PROMPT", KIT);
    expect(out.startsWith("BAZOWY PROMPT")).toBe(true); // baza nietknięta
    expect(out).toMatch(/TOŻSAMOŚĆ MARKI/);
    expect(out).toMatch(/Lipa Cafe/);
  });

  it("brak marki → system bez zmian (stara ścieżka identyczna)", () => {
    expect(appendBrand("BAZOWY PROMPT", {})).toBe("BAZOWY PROMPT");
  });
});

describe("brandImageSuffix — dodatek do promptu obrazu", () => {
  it("dokleja paletę i styl marki", () => {
    const s = brandImageSuffix(KIT);
    expect(s).toMatch(/paleta marki: brąz #5A3E2B/);
    expect(s).toMatch(/styl: rzemieślnicza/);
  });
  it("brak marki → pusty sufiks", () => {
    expect(brandImageSuffix({})).toBe("");
  });
});
