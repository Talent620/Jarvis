import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { idbAvailable, idbGet, idbSet, idbDelete, __resetDbForTests } from "../src/lib/db";

describe("db.ts — warstwa IndexedDB (Dexie)", () => {
  beforeEach(() => __resetDbForTests());

  it("zgłasza dostępność, gdy jest indexedDB (fake)", () => {
    expect(idbAvailable()).toBe(true);
  });

  it("zapis/odczyt całej kolekcji (roundtrip)", async () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ id: String(i), embedding: [i, i + 1, i + 2] }));
    expect(await idbSet("memory", big)).toBe(true);
    const back = await idbGet<typeof big>("memory");
    expect(back).toEqual(big);
  });

  it("brak klucza → null", async () => {
    expect(await idbGet("nie-ma")).toBeNull();
  });

  it("delete usuwa klucz", async () => {
    await idbSet("sentMail", [{ id: "a" }]);
    await idbDelete("sentMail");
    expect(await idbGet("sentMail")).toBeNull();
  });
});
