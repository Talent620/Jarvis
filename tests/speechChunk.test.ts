// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { splitForSpeech } from "../src/lib/voice";

describe("splitForSpeech — szybki start głosu (kawałki zdań)", () => {
  it("dzieli na zdania i scala krótkie do limitu", () => {
    const chunks = splitForSpeech("Cześć. Jak się masz? Dziś jest ładny dzień.", 200);
    expect(chunks.length).toBe(1); // krótkie → jeden kawałek
    expect(chunks[0]).toMatch(/Cześć/);
  });

  it("pierwszy kawałek jest krótki, gdy tekst jest długi (szybki start)", () => {
    const long = Array.from({ length: 20 }, (_, i) => `To jest zdanie numer ${i + 1} w długiej odpowiedzi.`).join(" ");
    const chunks = splitForSpeech(long, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(120);
    // Złączenie kawałków odtwarza całość (bez gubienia treści).
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " "));
  });

  it("pojedyncze bardzo długie zdanie jest twardo dzielone", () => {
    const huge = "słowo ".repeat(80).trim() + ".";
    const chunks = splitForSpeech(huge, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(102);
  });

  it("pusty tekst → brak kawałków", () => {
    expect(splitForSpeech("   ")).toEqual([]);
  });
});
