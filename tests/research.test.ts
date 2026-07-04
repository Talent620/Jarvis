// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tavilySearch, hasWebSearch, groundingBlock } from "../src/lib/research";
import { store } from "../src/lib/store";

beforeEach(() => { vi.unstubAllGlobals(); store.setSettings({ tavilyApiKey: "", proxyUrl: "" }); });

describe("research — hasWebSearch", () => {
  it("zależy od klucza Tavily LUB skonfigurowanego BFF (proxy)", () => {
    store.setSettings({ tavilyApiKey: "", proxyUrl: "" });
    expect(hasWebSearch()).toBe(false);
    store.setSettings({ tavilyApiKey: "tvly-x" });
    expect(hasWebSearch()).toBe(true);
    store.setSettings({ tavilyApiKey: "", proxyUrl: "https://bff.example.com" });
    expect(hasWebSearch()).toBe(true);
  });
});

describe("research — groundingBlock (pure)", () => {
  it("pusta lista → pusty string", () => {
    expect(groundingBlock([])).toBe("");
  });
  it("buduje blok z URLami i instrukcją „nie wymyślaj”", () => {
    const b = groundingBlock([{ title: "Lampa", url: "https://allegro.pl/x", content: "tania lampa 99 zł" }]);
    expect(b).toMatch(/REALNE WYNIKI/);
    expect(b).toMatch(/NIE wymyślaj/);
    expect(b).toMatch(/https:\/\/allegro\.pl\/x/);
  });
});

describe("research — tavilySearch", () => {
  it("bez klucza → pusta lista (nie woła sieci)", async () => {
    store.setSettings({ tavilyApiKey: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await tavilySearch("lampa")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("z kluczem parsuje wyniki i odrzuca wpisy bez URL http", async () => {
    store.setSettings({ tavilyApiKey: "tvly-x" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      results: [
        { title: "Allegro", url: "https://allegro.pl/x", content: "99 zł" },
        { title: "Zły", url: "ftp://nope", content: "x" },
      ],
    }), { status: 200 })));
    const hits = await tavilySearch("lampa");
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe("https://allegro.pl/x");
  });
  it("błąd sieci → pusta lista (graceful)", async () => {
    store.setSettings({ tavilyApiKey: "tvly-x" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await tavilySearch("lampa")).toEqual([]);
  });
  it("z proxy: woła BFF /v1/search (bez CORS) i mapuje wyniki", async () => {
    store.setSettings({ tavilyApiKey: "", proxyUrl: "https://bff.example.com" });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ results: [{ title: "Wiki", url: "https://wiki/x", content: "fakt" }] }), { status: 200 });
    }));
    const hits = await tavilySearch("co to jest");
    expect(calls[0]).toBe("https://bff.example.com/v1/search");
    expect(hits).toEqual([{ title: "Wiki", url: "https://wiki/x", content: "fakt" }]);
  });
  it("proxy pusto → fallback na bezpośrednie wywołanie kluczem użytkownika", async () => {
    store.setSettings({ tavilyApiKey: "tvly-x", proxyUrl: "https://bff.example.com" });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("/v1/search")) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      return new Response(JSON.stringify({ results: [{ title: "T", url: "https://t/1", content: "c" }] }), { status: 200 });
    }));
    const hits = await tavilySearch("x");
    expect(calls.some((u) => u.includes("/v1/search"))).toBe(true);
    expect(calls.some((u) => u.includes("api.tavily.com"))).toBe(true); // fallback
    expect(hits[0].url).toBe("https://t/1");
  });
  it("usuwa duplikaty URL", async () => {
    store.setSettings({ tavilyApiKey: "tvly-x" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      results: [
        { title: "A", url: "https://dup/1", content: "1" },
        { title: "A2", url: "https://dup/1", content: "2" },
        { title: "B", url: "https://dup/2", content: "3" },
      ],
    }), { status: 200 })));
    const hits = await tavilySearch("x");
    expect(hits.map((h) => h.url)).toEqual(["https://dup/1", "https://dup/2"]);
  });
});
