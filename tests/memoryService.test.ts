// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveNamespace, memoriesToBlock, parseMemories,
  addMemory, searchMemory, getAllMemories, memoryServiceAvailable, memoryContextBlock,
} from "../src/lib/memoryService";
import { store } from "../src/lib/store";

afterEach(() => vi.unstubAllGlobals());

describe("MemoryService — funkcje czyste", () => {
  it("resolveNamespace: projekt → business, brak → personal", () => {
    expect(resolveNamespace("proj1")).toBe("business");
    expect(resolveNamespace("")).toBe("personal");
    expect(resolveNamespace(undefined)).toBe("personal");
  });

  it("memoriesToBlock formatuje i ucina, pomija puste", () => {
    expect(memoriesToBlock([])).toBe("");
    const b = memoriesToBlock([{ id: "1", memory: "Lubi kawę" }, { id: "2", memory: "  " } as any, { id: "3", memory: "Mieszka w Krakowie" }]);
    expect(b).toContain("Lubi kawę");
    expect(b).toContain("Mieszka w Krakowie");
    expect(b.split("\n").filter((l) => l.startsWith("•")).length).toBe(2); // puste odrzucone
  });

  it("parseMemories normalizuje {results} i [] oraz pola memory/text", () => {
    expect(parseMemories({ results: [{ id: "a", memory: "x" }, { id: "b", text: "y" }] }).map((m) => m.memory)).toEqual(["x", "y"]);
    expect(parseMemories([{ id: "c", memory: "z" }])[0].id).toBe("c");
    expect(parseMemories(null)).toEqual([]);
  });
});

describe("MemoryService — sieć (mock) + graceful degradation", () => {
  beforeEach(() => store.setSettings({ memoryServiceUrl: "", memoryServiceToken: "" }));

  it("bez skonfigurowanego adresu: available=false, search/add degradują", async () => {
    expect(memoryServiceAvailable()).toBe(false);
    expect(await searchMemory("cokolwiek", "personal")).toEqual([]);
    expect(await addMemory([{ role: "user", content: "hej" }], "personal")).toBe(false);
    expect(await memoryContextBlock("q", "personal")).toBe("");
  });

  it("błąd sieci nie wysadza — search→[], add→false", async () => {
    store.setSettings({ memoryServiceUrl: "http://mem.local" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await searchMemory("q", "personal")).toEqual([]);
    expect(await addMemory([{ role: "user", content: "x" }], "personal")).toBe(false);
  });

  it("add wysyła messages + user_id; ok=true przy 200", async () => {
    store.setSettings({ memoryServiceUrl: "http://mem.local", memoryServiceToken: "tok" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await addMemory([{ role: "user", content: "Lubię herbatę" }], "personal");
    expect(ok).toBe(true);
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse((opts as any).body);
    expect(body.user_id).toBe("personal");
    expect(body.messages[0].content).toBe("Lubię herbatę");
    expect((opts as any).headers.authorization).toBe("Bearer tok");
  });

  it("izolacja namespace: search zwraca tylko dane z właściwego user_id", async () => {
    store.setSettings({ memoryServiceUrl: "http://mem.local" });
    const db: Record<string, string[]> = {
      personal: ["Mieszka w Krakowie"],
      business: ["Klient ACME woli kontakt mailowy"],
    };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: any) => {
      const ns = JSON.parse(opts.body).user_id as string;
      const results = (db[ns] || []).map((memory, i) => ({ id: `${ns}-${i}`, memory, score: 0.9 }));
      return new Response(JSON.stringify({ results }), { status: 200 });
    }));
    const personal = await searchMemory("gdzie mieszka", "personal");
    const business = await searchMemory("preferencje klienta", "business");
    expect(personal.map((m) => m.memory)).toEqual(["Mieszka w Krakowie"]);
    expect(business.map((m) => m.memory)).toEqual(["Klient ACME woli kontakt mailowy"]);
    expect(personal.some((m) => m.memory.includes("ACME"))).toBe(false); // brak przecieku
  });

  it("getAllMemories czyta listę po namespace", async () => {
    store.setSettings({ memoryServiceUrl: "http://mem.local" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [{ id: "1", memory: "fakt" }] }), { status: 200 })));
    const all = await getAllMemories("personal");
    expect(all).toHaveLength(1);
    expect(all[0].memory).toBe("fakt");
  });
});
