// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { normalizeData, store } from "../src/lib/store";
import type { AppData } from "../src/types";

describe("store — normalizeData (#1: odporność na uszkodzony localStorage)", () => {
  it("wymusza tablice na uszkodzonych kolekcjach", () => {
    const bad = { tasks: null, leads: undefined, notes: "zepsute", financeProjects: 5 } as unknown as AppData;
    const d = normalizeData(bad);
    expect(Array.isArray(d.tasks)).toBe(true);
    expect(Array.isArray(d.leads)).toBe(true);
    expect(Array.isArray(d.notes)).toBe(true);
    expect(Array.isArray(d.financeProjects)).toBe(true);
    // po normalizacji można bezpiecznie operować
    expect(() => d.tasks.unshift({ id: "1", title: "x", done: false, createdAt: 0 } as never)).not.toThrow();
  });

  it("naprawia uszkodzony world (brak relations/entities)", () => {
    const d1 = normalizeData({ world: { entities: [{ id: "a" }] } } as unknown as AppData);
    expect(Array.isArray(d1.world!.relations)).toBe(true);
    expect(Array.isArray(d1.world!.entities)).toBe(true);
    const d2 = normalizeData({ world: null } as unknown as AppData);
    expect(d2.world).toEqual({ entities: [], relations: [] });
  });

  it("idempotentne — poprawnych danych nie psuje", () => {
    const ok = normalizeData({ tasks: [{ id: "1" }], world: { entities: [], relations: [] } } as unknown as AppData);
    expect(ok.tasks).toHaveLength(1);
  });
});

describe("store — emit izoluje błędy listenerów (#3)", () => {
  beforeEach(() => store.setData((d) => { d.tasks = []; }));
  it("wadliwy listener nie blokuje pozostałych", () => {
    let good = 0;
    const offBad = store.subscribe(() => { throw new Error("zły listener"); });
    const offGood = store.subscribe(() => { good++; });
    expect(() => store.setData((d) => { d.tasks.unshift({ id: "1", title: "t", done: false, createdAt: 0 } as never); })).not.toThrow();
    expect(good).toBeGreaterThan(0); // dobry listener i tak dostał powiadomienie
    offBad(); offGood();
  });
});

describe("store — setData nie wywala apki przy rzucającym mutatorze (#5)", () => {
  it("wyjątek w mutatorze jest złapany, apka działa dalej", () => {
    expect(() => store.setData(() => { throw new Error("boom"); })).not.toThrow();
    // store nadal działa
    expect(() => store.setData((d) => { d.notes.unshift({ id: "n", text: "ok", createdAt: 0 } as never); })).not.toThrow();
    expect(store.data.notes.some((n) => n.text === "ok")).toBe(true);
  });
});
