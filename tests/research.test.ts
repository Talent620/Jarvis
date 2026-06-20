// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tavilySearch, hasWebSearch, groundingBlock } from "../src/lib/research";
import { store } from "../src/lib/store";

beforeEach(() => { vi.unstubAllGlobals(); store.setSettings({ tavilyApiKey: "" }); });

describe("research — hasWebSearch", () => {
  it("zależy od klucza Tavily", () => {
    store.setSettings({ tavilyApiKey: "" });
    expect(hasWebSearch()).toBe(false);
    store.setSettings({ tavilyApiKey: "tvly-x" });
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
});
