// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { cosine, rememberFact } from "../src/lib/memory";
import { store } from "../src/lib/store";

beforeEach(() => {
  store.setData((d) => {
    d.memory = [];
  });
});

describe("cosine (podobieństwo semantyczne)", () => {
  it("zwraca 1 dla identycznych wektorów", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
  it("zwraca 0 dla prostopadłych", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
  it("bezpiecznie obsługuje puste/niezgodne długości", () => {
    expect(cosine([], [1])).toBe(0);
    expect(cosine([1, 2], [1])).toBe(0);
  });
});

describe("rememberFact (pamięć autonomiczna)", () => {
  it("zapisuje nowy fakt", () => {
    rememberFact("imie", "Marcin");
    expect(store.data.memory.find((m) => m.key === "imie")?.value).toBe("Marcin");
  });
  it("deduplikuje po kluczu (aktualizuje wartość)", () => {
    rememberFact("miasto", "Kraków");
    rememberFact("miasto", "Warszawa");
    const hits = store.data.memory.filter((m) => m.key === "miasto");
    expect(hits.length).toBe(1);
    expect(hits[0].value).toBe("Warszawa");
  });
  it("utrzymuje twardy limit 300 faktów", () => {
    for (let i = 0; i < 320; i++) rememberFact(`klucz_${i}`, `wartość_${i}`);
    expect(store.data.memory.length).toBeLessThanOrEqual(300);
  });
  it("zachowuje przypięte fakty mimo limitu", () => {
    rememberFact("ważny", "nie usuwaj");
    store.setData((d) => {
      const f = d.memory.find((m) => m.key === "ważny");
      if (f) f.pinned = true;
    });
    for (let i = 0; i < 320; i++) rememberFact(`k_${i}`, `v_${i}`);
    expect(store.data.memory.some((m) => m.key === "ważny" && m.pinned)).toBe(true);
  });
});
