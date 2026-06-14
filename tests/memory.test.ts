// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { cosine, rememberFact, deleteFact, setFactPinned, editFact } from "../src/lib/memory";
import { store } from "../src/lib/store";

beforeEach(() => {
  store.setData((d) => {
    d.memory = [];
  });
});

describe("Centrum Pamięci — kontrola użytkownika", () => {
  it("deleteFact usuwa po id (inne zostają)", () => {
    rememberFact("a", "1"); rememberFact("b", "2");
    const id = store.data.memory.find((m) => m.key === "a")!.id;
    deleteFact(id);
    expect(store.data.memory.some((m) => m.key === "a")).toBe(false);
    expect(store.data.memory.some((m) => m.key === "b")).toBe(true);
  });

  it("setFactPinned przypina i odpina", () => {
    rememberFact("c", "3");
    const id = store.data.memory.find((m) => m.key === "c")!.id;
    setFactPinned(id, true);
    expect(store.data.memory.find((m) => m.id === id)!.pinned).toBe(true);
    setFactPinned(id, false);
    expect(store.data.memory.find((m) => m.id === id)!.pinned).toBe(false);
  });

  it("editFact zmienia wartość i kasuje wektor (do przeliczenia)", () => {
    rememberFact("d", "stare");
    const f = store.data.memory.find((m) => m.key === "d")!;
    f.embedding = [1, 2, 3];
    editFact(f.id, "nowe");
    const after = store.data.memory.find((m) => m.id === f.id)!;
    expect(after.value).toBe("nowe");
    expect(after.embedding).toBeUndefined();
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
