import { describe, it, expect } from "vitest";
import { supportsGrounding, parseGroundingCitations } from "../src/lib/geminiCapabilities";

describe("geminiGrounding — capability + parsowanie źródeł", () => {
  it("nowoczesne modele wspierają grounding; stare/embeddingi nie", () => {
    expect(supportsGrounding("gemini-2.5-flash")).toBe(true);
    expect(supportsGrounding("gemini-3-pro")).toBe(true);
    expect(supportsGrounding("text-embedding-004")).toBe(false);
  });

  it("wyłuskuje PRAWDZIWE źródła z groundingMetadata", () => {
    const data = { candidates: [{ groundingMetadata: { groundingChunks: [
      { web: { uri: "https://a.pl/x", title: "Strona A" } },
      { web: { uri: "https://b.pl/y", title: "Strona B" } },
    ] } }] };
    const c = parseGroundingCitations(data);
    expect(c).toEqual([{ title: "Strona A", url: "https://a.pl/x" }, { title: "Strona B", url: "https://b.pl/y" }]);
  });

  it("brak metadata → [] (caller użyje zwykłego research, nie wymyśli źródeł)", () => {
    expect(parseGroundingCitations({ candidates: [{ content: { parts: [{ text: "x" }] } }] })).toEqual([]);
    expect(parseGroundingCitations(null)).toEqual([]);
  });

  it("dedup po URL i fallback tytułu do URL", () => {
    const data = { candidates: [{ groundingMetadata: { groundingChunks: [
      { web: { uri: "https://a.pl/x" } },
      { web: { uri: "https://a.pl/x", title: "dup" } },
    ] } }] };
    const c = parseGroundingCitations(data);
    expect(c.length).toBe(1);
    expect(c[0].title).toBe("https://a.pl/x"); // brak tytułu → URL
  });
});
