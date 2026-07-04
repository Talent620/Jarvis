import { describe, it, expect } from "vitest";
import { geminiRequestTools, supportsGrounding } from "../src/lib/geminiCapabilities";

// REGRESJA realnego błędu 400 zgłoszonego przez użytkownika:
// „Built-in tools (google_search) and Function Calling cannot be combined in the same request."
// Gemini ZABRANIA łączyć googleSearch (grounding) z function calling w jednym żądaniu.
// geminiRequestTools MUSI gwarantować, że nigdy nie wysyłamy obu naraz.

const fns = [{ name: "add_task", description: "x", parameters: {} }];

describe("geminiRequestTools — nigdy googleSearch + functionDeclarations naraz", () => {
  it("REPRODUKCJA/OBRONA: narzędzia + grounding → TYLKO function calling (zero googleSearch)", () => {
    const { tools, groundingSkipped } = geminiRequestTools(fns, true);
    expect(tools).toHaveLength(1);
    const hasGoogleSearch = (tools as any[]).some((t) => "googleSearch" in t);
    const hasFns = (tools as any[]).some((t) => "functionDeclarations" in t);
    expect(hasGoogleSearch).toBe(false); // TO powodowało 400 — nie może się pojawić
    expect(hasFns).toBe(true);
    expect(groundingSkipped).toBe(true); // uczciwie odnotowane, nie zgadywane
  });

  it("same narzędzia (bez groundingu) → function calling, nic nie pominięte", () => {
    const { tools, groundingSkipped } = geminiRequestTools(fns, false);
    expect((tools as any[])[0]).toHaveProperty("functionDeclarations");
    expect(groundingSkipped).toBe(false);
  });

  it("brak narzędzi, grounding chciany → sam googleSearch (dozwolone, bez function calling)", () => {
    const { tools, groundingSkipped } = geminiRequestTools([], true);
    expect(tools).toEqual([{ googleSearch: {} }]);
    expect(groundingSkipped).toBe(false);
  });

  it("nic nie chciane → brak pola tools (undefined)", () => {
    expect(geminiRequestTools([], false)).toEqual({ tools: undefined, groundingSkipped: false });
  });

  it("każde żądanie z narzędziami ma co najwyżej JEDEN wpis tools i nigdy googleSearch obok fns", () => {
    for (const grounding of [true, false]) {
      const { tools } = geminiRequestTools(fns, grounding);
      expect(tools).toHaveLength(1);
      // twardy inwariant: żaden pojedynczy wpis nie łączy obu kluczy, i nie ma dwóch wpisów
      for (const entry of tools as any[]) {
        const keys = Object.keys(entry);
        expect(keys).not.toContain("googleSearch");
      }
    }
  });

  it("supportsGrounding rozpoznaje rodziny modeli (kontekst decyzji useGrounding)", () => {
    expect(supportsGrounding("gemini-2.5-flash")).toBe(true);
    expect(supportsGrounding("gemini-3-pro")).toBe(true);
  });
});
