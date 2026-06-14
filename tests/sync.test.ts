// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pullSync } from "../src/lib/sync";
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
    expect(r).toMatch(/pobrane/i);
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
