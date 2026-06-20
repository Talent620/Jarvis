// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { generateSite, buildClientBrief, clientHandoverMessage } from "../src/lib/webgen";
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

  it("przyjmuje styl (auto/editorial/brutalist/glass/neon/retro/organic/swiss/luxury)", async () => {
    for (const style of ["auto", "editorial", "brutalist", "glass", "neon", "retro", "organic", "swiss", "luxury"] as const) {
      const r = await generateSite("test", undefined, "auto", style);
      expect("error" in r).toBe(true); // brak klucza → error, ale wywołanie poprawne typowo
    }
  });
});

describe("Kreator stron — brief klienta (pure)", () => {
  it("buildClientBrief składa tylko wypełnione pola z etykietami", () => {
    const out = buildClientBrief({ business: "Kawa Nova", industry: "kawiarnia", contact: "tel 600", goal: "" });
    expect(out).toMatch(/Firma\/marka: Kawa Nova/);
    expect(out).toMatch(/Branża: kawiarnia/);
    expect(out).toMatch(/Dane kontaktowe.*tel 600/);
    expect(out).not.toMatch(/Cel strony/); // puste pominięte
  });
  it("pusty brief → pusty string", () => {
    expect(buildClientBrief({})).toBe("");
  });
  it("clientHandoverMessage zawiera nazwę firmy i kolejne kroki", () => {
    const m = clientHandoverMessage("Kawa Nova");
    expect(m).toMatch(/Kawa Nova/);
    expect(m).toMatch(/publikacja online|domen/i);
  });
});
