import { describe, it, expect } from "vitest";
import { nextSnapshot, shallowEqual } from "../src/hooks/useStore";

describe("useStoreSelector — nextSnapshot (stabilna referencja snapshotu)", () => {
  it("zwraca TĘ SAMĄ referencję, gdy wartość niezmieniona (Object.is) — brak zbędnego re-rendera", () => {
    const prev = nextSnapshot(null, "dark", Object.is);
    const same = nextSnapshot(prev, "dark", Object.is);
    expect(same).toBe(prev); // ta sama referencja → React pominie re-render
    expect(same.value).toBe("dark");
  });

  it("zwraca NOWĄ referencję, gdy wartość się zmieniła", () => {
    const prev = nextSnapshot(null, 1, Object.is);
    const next = nextSnapshot(prev, 2, Object.is);
    expect(next).not.toBe(prev);
    expect(next.value).toBe(2);
  });

  it("z selektorem obiektowym + shallowEqual: stabilna referencja gdy płytko równe", () => {
    const a = nextSnapshot<{ n: number }>(null, { n: 5 }, shallowEqual);
    const b = nextSnapshot(a, { n: 5 }, shallowEqual); // nowy obiekt, ta sama treść
    expect(b).toBe(a); // shallowEqual → stabilna referencja (brak pętli re-renderów)
    const c = nextSnapshot(b, { n: 6 }, shallowEqual);
    expect(c).not.toBe(b);
  });
});

describe("useStoreSelector — shallowEqual", () => {
  it("prymitywy i ta sama referencja", () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual("a", "b")).toBe(false);
    const o = { x: 1 };
    expect(shallowEqual(o, o)).toBe(true);
  });
  it("obiekty: płytko równe / różne", () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
  it("tablice: po referencjach elementów", () => {
    expect(shallowEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
  });
  it("null/undefined bezpieczne", () => {
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual(undefined, null)).toBe(false);
  });
});
