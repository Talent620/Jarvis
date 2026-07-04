// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { musicCommand } from "../src/lib/music";

describe("Tryb Słuchawki — sterowanie muzyką", () => {
  afterEach(() => {
    delete (window as any).jarvisDesktop;
  });

  it("na telefonie (bez mostka desktop) → czytelna podpowiedź, bez wyjątku", async () => {
    const r = await musicCommand("next");
    expect(typeof r).toBe("string");
    expect(r).toMatch(/następna|piosenk/i);
  });

  it("na komputerze deleguje do klawiszy multimedialnych Electrona", async () => {
    const media: string[] = [];
    (window as any).jarvisDesktop = {
      media: (a: string) => { media.push(a); return Promise.resolve("ok"); },
      volume: () => Promise.resolve("ok"),
    };
    await musicCommand("next");
    await musicCommand("playpause");
    expect(media).toContain("next");
    expect(media).toContain("playpause");
  });
});
