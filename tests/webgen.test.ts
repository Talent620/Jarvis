// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { generateSite } from "../src/lib/webgen";
import { store } from "../src/lib/store";

const noKeys = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" };

describe("Kreator stron — generateSite", () => {
  beforeEach(() => store.setSettings({ provider: "auto", keys: { ...noKeys }, ollamaUrl: "" }));

  it("bez dostawcy AI → czytelny błąd zamiast wyjątku", async () => {
    const r = await generateSite("sklep z kawą", undefined, "sklep");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/skonfiguruj dostawc/i);
  });

  it("przyjmuje typ witryny (sklep/landing/firma/portfolio/auto) bez błędu typów", async () => {
    for (const kind of ["auto", "sklep", "landing", "firma", "portfolio"] as const) {
      const r = await generateSite("test", undefined, kind);
      expect("error" in r).toBe(true); // brak klucza → error, ale wywołanie poprawne
    }
  });
});
