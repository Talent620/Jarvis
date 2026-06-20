import { describe, it, expect } from "vitest";
import { isNearBottom, starterSuggestions } from "../src/lib/chatUx";

describe("isNearBottom — inteligentne auto-przewijanie", () => {
  it("dół listy → true (auto-scroll pożądany)", () => {
    expect(isNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true); // dystans 0
    expect(isNearBottom({ scrollTop: 820, scrollHeight: 1000, clientHeight: 100 })).toBe(true); // dystans 80 ≤ 120
  });
  it("przewinięte w górę → false (nie wyrywaj użytkownika)", () => {
    expect(isNearBottom({ scrollTop: 200, scrollHeight: 1000, clientHeight: 100 })).toBe(false); // dystans 700
  });
  it("respektuje próg", () => {
    expect(isNearBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 100 }, 250)).toBe(true); // dystans 200 ≤ 250
  });
});

describe("starterSuggestions — podpowiedzi zależne od pory i kontekstu", () => {
  it("rano proponuje raport poranny", () => {
    const s = starterSuggestions(new Date("2026-06-20T08:00:00"));
    expect(s.some((x) => /poranny/i.test(x))).toBe(true);
  });
  it("wieczorem proponuje podsumowanie dnia", () => {
    const s = starterSuggestions(new Date("2026-06-20T20:00:00"));
    expect(s.some((x) => /podsumuj|jutro/i.test(x))).toBe(true);
  });
  it("z zadaniami na dziś podbija je na górę", () => {
    const s = starterSuggestions(new Date("2026-06-20T09:00:00"), { tasksToday: 3 });
    expect(s[0]).toMatch(/3 zadania/);
  });
  it("zwraca maks. 5 i bez duplikatów", () => {
    const s = starterSuggestions(new Date("2026-06-20T09:00:00"), { tasksToday: 1, desktop: true });
    expect(s.length).toBeLessThanOrEqual(5);
    expect(new Set(s).size).toBe(s.length);
  });
});
