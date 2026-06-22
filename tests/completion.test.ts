import { describe, it, expect } from "vitest";
import { completionReport } from "../src/lib/completion";
import type { Settings } from "../src/types";

// Minimalny obiekt ustawień (tylko pola, których dotyka completion).
const base = (over: Partial<Settings> = {}): Settings => ({
  keys: {}, speak: false, webSearch: false, proactiveOnOpen: false, tips: false,
  backgroundWake: false, bossFullAccess: false, ...over,
} as unknown as Settings);

describe("completionReport — droga do 100%", () => {
  it("pusty profil → niski %, pierwszy krok to mózg (klucz API)", () => {
    const r = completionReport(base());
    expect(r.percent).toBeLessThan(50);
    expect(r.next?.id).toBe("brain");
    expect(r.next?.openScreen).toBe("ai");
  });

  it("krok auto (np. głos) ma gotowy patch — Szef zrobi sam", () => {
    // Mózg jest (klucz), imię jest → następne to auto-kroki z patchem.
    const r = completionReport(base({ keys: { gemini: "k" } as any, userName: "Artur" }));
    expect(r.next?.patch).toBeTruthy();
  });

  it("wszystko skonfigurowane → 100% i brak next", () => {
    const r = completionReport(base({
      keys: { gemini: "k" } as any, userName: "Artur", speak: true, webSearch: true,
      proactiveOnOpen: true, tips: true, backgroundWake: true, bossFullAccess: true, proxyUrl: "https://x",
    }));
    expect(r.percent).toBe(100);
    expect(r.next).toBeNull();
  });

  it("% rośnie z każdą spełnioną pozycją", () => {
    const a = completionReport(base()).percent;
    const b = completionReport(base({ speak: true })).percent;
    expect(b).toBeGreaterThan(a);
  });
});
