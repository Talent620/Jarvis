import { describe, it, expect } from "vitest";
import { estimateBpm, type PpgSample } from "../src/lib/ppg";

// Generuje syntetyczny sygnał PPG: sinus o danym tętnie + dryf + szum.
function synth(bpm: number, seconds = 20, fps = 30): PpgSample[] {
  const hz = bpm / 60;
  const out: PpgSample[] = [];
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < seconds * fps; i++) {
    const t = (i / fps) * 1000;
    const beat = Math.sin(2 * Math.PI * hz * (t / 1000)) * 8;
    const drift = Math.sin(2 * Math.PI * 0.05 * (t / 1000)) * 20; // wolny dryf jasności
    out.push({ t, v: 150 + beat + drift + rnd() * 2 });
  }
  return out;
}

describe("estimateBpm (pomiar tętna z PPG)", () => {
  it("odczytuje 60 bpm z dokładnością ±6", () => {
    const r = estimateBpm(synth(60))!;
    expect(r).toBeGreaterThanOrEqual(54);
    expect(r).toBeLessThanOrEqual(66);
  });
  it("odczytuje 75 bpm z dokładnością ±6", () => {
    const r = estimateBpm(synth(75))!;
    expect(r).toBeGreaterThanOrEqual(69);
    expect(r).toBeLessThanOrEqual(81);
  });
  it("odczytuje 100 bpm z dokładnością ±8", () => {
    const r = estimateBpm(synth(100))!;
    expect(r).toBeGreaterThanOrEqual(92);
    expect(r).toBeLessThanOrEqual(108);
  });
  it("zwraca null dla zbyt krótkiej próbki", () => {
    expect(estimateBpm([{ t: 0, v: 1 }])).toBeNull();
  });
});
