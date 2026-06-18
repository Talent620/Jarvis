import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Prosty shim localStorage dla środowiska node (trzymany przez cały plik, by przetrwać reset modułów).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
}

const ls = new MemStorage();
(globalThis as unknown as { localStorage: MemStorage }).localStorage = ls;

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("store ↔ IndexedDB — migracja i hydratacja", () => {
  beforeEach(async () => {
    ls.clear();
    vi.resetModules();
    // Wyczyść współdzieloną (globalną) bazę fake-indexeddb między testami.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("jarvis");
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });

  it("migruje duże kolekcje z localStorage do IDB i odchudza blob, bez utraty danych", async () => {
    // Stan sprzed migracji: dane (w tym memory z embeddingami) w localStorage, brak flagi.
    ls.setItem("jarvis.data.v2", JSON.stringify({
      tasks: [{ id: "t1", title: "zadanie" }],
      memory: [{ id: "m1", key: "imię", value: "Marcin", createdAt: 1, embedding: [0.1, 0.2, 0.3] }],
      sentMail: [{ id: "s1", to: "x@y.pl" }],
      contentPosts: [{ id: "c1", body: "post" }],
    }));

    const db = await import("../src/lib/db");
    db.__resetDbForTests();
    const { store } = await import("../src/lib/store");

    // Po migracji: flaga ustawiona, blob localStorage odchudzony, dane w IDB, RAM nienaruszone.
    await waitFor(() => ls.getItem("jarvis.idb.migrated.v1") === "1");
    await waitFor(async () => true); // domknij mikrozadania
    await new Promise((r) => setTimeout(r, 50));

    expect(store.data.memory).toHaveLength(1);     // RAM: dane są
    expect(store.data.tasks).toHaveLength(1);      // małe kolekcje nietknięte

    const slim = JSON.parse(ls.getItem("jarvis.data.v2")!);
    expect(slim.memory).toHaveLength(0);           // localStorage odchudzony
    expect(slim.sentMail).toHaveLength(0);
    expect(slim.tasks).toHaveLength(1);            // małe zostają w localStorage

    expect(await db.idbGet("memory")).toEqual([{ id: "m1", key: "imię", value: "Marcin", createdAt: 1, embedding: [0.1, 0.2, 0.3] }]);
  });

  it("hydratuje duże kolekcje z IDB do RAM przy kolejnym starcie", async () => {
    // Symuluj stan po migracji: flaga + odchudzony blob, a dane żyją w IDB.
    ls.setItem("jarvis.idb.migrated.v1", "1");
    ls.setItem("jarvis.data.v2", JSON.stringify({ tasks: [{ id: "t1" }], memory: [], sentMail: [], contentPosts: [] }));
    const db = await import("../src/lib/db");
    db.__resetDbForTests();
    await db.idbSet("memory", [{ id: "m9", key: "auto", value: "Tesla", createdAt: 2 }]);

    const { store } = await import("../src/lib/store");
    await waitFor(() => store.data.memory.length > 0);
    expect(store.data.memory[0].value).toBe("Tesla");
  });

  it("setData zapisuje duże kolekcje do IDB (debounce)", async () => {
    ls.setItem("jarvis.idb.migrated.v1", "1");
    ls.setItem("jarvis.data.v2", JSON.stringify({ memory: [], sentMail: [], contentPosts: [] }));
    const db = await import("../src/lib/db");
    db.__resetDbForTests();
    const { store } = await import("../src/lib/store");
    await waitFor(() => true);
    await new Promise((r) => setTimeout(r, 20));

    store.setData((d) => { d.sentMail.unshift({ id: "new1", to: "a@b.c", subject: "x", at: Date.now() }); });
    await new Promise((r) => setTimeout(r, 400)); // przeczekaj debounce (300 ms) flushu do IDB
    const arr = await db.idbGet<{ id: string }[]>("sentMail");
    expect(arr?.[0]?.id).toBe("new1");
  });
});
