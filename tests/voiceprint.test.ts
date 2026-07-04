import { describe, it, expect } from "vitest";
import { melBands, cosine, embed, buildProfile, matchScore } from "../src/lib/voiceprint";

const SR = 48000;
const BINS = 1024; // fftSize 2048

// Syntetyczne widmo dB: cisza -120, „energia" -20 w zadanym zakresie binów.
function spectrum(loBin: number, hiBin: number): Float32Array {
  const a = new Float32Array(BINS).fill(-120);
  for (let i = loBin; i < hiBin; i++) a[i] = -20;
  return a;
}

describe("melBands — redukcja widma do pasm", () => {
  it("zwraca wektor o stałej długości i skończone wartości", () => {
    const m = melBands(spectrum(10, 60), SR);
    expect(m.length).toBe(24);
    expect(m.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe("cosine + embed", () => {
  it("cosine identycznych = 1, prostopadłych = 0", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});

describe("odcisk głosu — rozróżnia profile", () => {
  it("dopasowanie do siebie wyższe niż do innego widma", () => {
    const low = melBands(spectrum(5, 40), SR);     // energia nisko (jak głos męski)
    const high = melBands(spectrum(300, 600), SR); // energia wysoko (inny głos)
    const profileLow = buildProfile([embed([low]), embed([low])]);
    const self = embed([low]);
    const other = embed([high]);
    const sSelf = matchScore(profileLow, self);
    const sOther = matchScore(profileLow, other);
    expect(sSelf).toBeGreaterThan(sOther);
    expect(sSelf).toBeGreaterThan(0.8); // ten sam głos = wysokie dopasowanie
  });
});
