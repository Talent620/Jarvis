import { describe, it, expect } from "vitest";
import { speakableChunks } from "../src/lib/speechStream";

describe("speakableChunks — strumieniowe cięcie na zdania", () => {
  it("zwraca tylko KOMPLETNE zdania, ogon zostaje na później", () => {
    const r = speakableChunks("Cześć. Jak się", 0, false);
    expect(r.chunks).toEqual(["Cześć."]);
    expect("Cześć. Jak się".slice(r.nextIndex)).toBe(" Jak się");
  });

  it("dokłada kolejne zdanie przy następnym tokenie (kursor postępuje)", () => {
    const full1 = "Cześć. Jak się";
    const a = speakableChunks(full1, 0, false); // ["Cześć."]
    const full2 = "Cześć. Jak się masz? Wszystko";
    const b = speakableChunks(full2, a.nextIndex, false);
    expect(b.chunks).toEqual(["Jak się masz?"]);
  });

  it("bez zakończonego zdania nie mówi nic (czeka)", () => {
    expect(speakableChunks("Jeszcze pisze", 0, false).chunks).toEqual([]);
  });

  it("final=true domyka resztę nawet bez kropki", () => {
    const r = speakableChunks("Cześć. Już kończę", 6, true);
    expect(r.chunks).toEqual(["Już kończę"]);
  });

  it("obsługuje !, ? oraz wielokropek …", () => {
    const r = speakableChunks("Super! Naprawdę? No proszę…", 0, false);
    expect(r.chunks).toEqual(["Super!", "Naprawdę?", "No proszę…"]);
  });

  it("nie używa lookbehind (działa na starym WebView) — brak wyjątku i poprawny podział", () => {
    expect(() => speakableChunks("A. B. C.", 0, true)).not.toThrow();
    expect(speakableChunks("A. B. C.", 0, true).chunks).toEqual(["A.", "B.", "C."]);
  });

  it("pusty/skonsumowany tekst → brak zdań", () => {
    expect(speakableChunks("", 0, true).chunks).toEqual([]);
    expect(speakableChunks("Koniec.", 7, true).chunks).toEqual([]);
  });
});
