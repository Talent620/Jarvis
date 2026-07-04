// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pullSync, mergeById } from "../src/lib/sync";
import { store } from "../src/lib/store";

// Pobieranie z chmury MUSI być odporne na uszkodzone dane — bierzemy tylko tablice,
// żeby zła odpowiedź backendu nie skorumpowała lokalnego store.
beforeEach(() => {
  store.setSettings({ syncUrl: "https://x.workers.dev", syncToken: "tok" });
  store.setData((d) => { (d as any).tasks = [{ id: "t1", title: "stare", done: false }]; (d as any).notes = []; });
});
afterEach(() => vi.unstubAllGlobals());

describe("pullSync — walidacja danych z chmury", () => {
  it("string zamiast tablicy nie nadpisuje store; poprawna tablica jest scalana", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { tasks: "ZEPSUTE", notes: [{ id: "n1", text: "ok", createdAt: 1 }] },
    }), { status: 200 })));
    const r = await pullSync();
    expect(r).toMatch(/scalone/i);
    expect(Array.isArray(store.data.tasks)).toBe(true);      // nie nadpisane stringiem
    expect((store.data.tasks as any)[0].id).toBe("t1");       // stare dane nietknięte
    expect(store.data.notes.length).toBe(1);                  // poprawna tablica scalona
  });

  it("brak pola data → komunikat, store bez zmian", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    const r = await pullSync();
    expect(r).toMatch(/Brak danych/i);
    expect(Array.isArray(store.data.tasks)).toBe(true);
  });
});

describe("mergeById — scalanie po id, nowsze wygrywa", () => {
  it("suma obu stron, brak gubienia lokalnych wpisów", () => {
    const local = [{ id: "a", updatedAt: 5 }, { id: "b", updatedAt: 5 }];
    const remote = [{ id: "b", updatedAt: 1 }, { id: "c", updatedAt: 9 }];
    const out = mergeById(local, remote);
    const ids = out.map((x) => x.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("przy kolizji id zostaje nowszy (po updatedAt)", () => {
    const out = mergeById([{ id: "x", updatedAt: 10, v: "local" } as any], [{ id: "x", updatedAt: 2, v: "remote" } as any]);
    expect(out.find((i) => i.id === "x")!.v).toBe("local"); // lokalna edycja nowsza → wygrywa
  });

  it("chmura nowsza nadpisuje lokalny wpis", () => {
    const out = mergeById([{ id: "x", updatedAt: 2, v: "local" } as any], [{ id: "x", updatedAt: 10, v: "remote" } as any]);
    expect(out.find((i) => i.id === "x")!.v).toBe("remote");
  });

  it("fallback na createdAt, gdy brak updatedAt; sortowanie newest-first", () => {
    const out = mergeById([{ id: "a", createdAt: 1 }], [{ id: "b", createdAt: 9 }]);
    expect(out[0].id).toBe("b"); // najnowszy na górze
  });
});
