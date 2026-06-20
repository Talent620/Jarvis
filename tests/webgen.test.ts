// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { generateSite, buildClientBrief, clientHandoverMessage, estimateQuote, formatQuote, marketRanges } from "../src/lib/webgen";
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

describe("Kreator stron — wycena (pure, rynek PL)", () => {
  it("estimateQuote: suma jednorazowa = suma pozycji, sklep ma płatności", () => {
    const q = estimateQuote("sklep", { business: "Sklep X" });
    const sumMin = q.oneTime.reduce((s, l) => s + l.min, 0);
    const sumMax = q.oneTime.reduce((s, l) => s + l.max, 0);
    expect(q.totalMin).toBe(sumMin);
    expect(q.totalMax).toBe(sumMax);
    expect(q.oneTime.some((l) => /płatnoś/i.test(l.label))).toBe(true);
    expect(q.totalMin).toBeLessThan(q.totalMax);
    expect(q.recurring.length).toBeGreaterThan(0);
  });
  it("landing tańszy od sklepu (rynkowo)", () => {
    expect(estimateQuote("landing").marketMax).toBeLessThan(estimateQuote("sklep").marketMax);
  });
  it("strona firmowa bez integracji płatności", () => {
    expect(estimateQuote("firma").oneTime.some((l) => /płatnoś/i.test(l.label))).toBe(false);
  });
  it("marketRanges zwraca typy bez 'auto', rosnące widełki", () => {
    const r = marketRanges();
    expect(r.find((x) => x.kind === "auto")).toBeUndefined();
    for (const x of r) expect(x.min).toBeLessThan(x.max);
  });
  it("formatQuote zawiera sumę, koszty cykliczne i kontekst rynkowy PL (zł)", () => {
    const q = estimateQuote("firma", { business: "Bud-Mar" });
    const txt = formatQuote(q, { business: "Bud-Mar" });
    expect(txt).toMatch(/Bud-Mar/);
    expect(txt).toMatch(/RAZEM \(jednorazowo\)/);
    expect(txt).toMatch(/rynkowo w Polsce/i);
    expect(txt).toMatch(/zł/);
  });
});
