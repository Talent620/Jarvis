// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { generateSite, buildClientBrief, clientHandoverMessage, estimateQuote, formatQuote, marketRanges, quotePackages, formatPackages, pickSiteStyle, auditSite } from "../src/lib/webgen";
import { store } from "../src/lib/store";

describe("pickSiteStyle — auto-dobór systemu projektowego", () => {
  it("kancelaria/finanse → enterprise", () => {
    expect(pickSiteStyle("Nowoczesna strona dla kancelarii prawnej")).toBe("enterprise");
    expect(pickSiteStyle("biuro księgowe i doradztwo podatkowe")).toBe("enterprise");
  });
  it("SaaS/aplikacja → linear; fintech → stripe", () => {
    expect(pickSiteStyle("platforma SaaS z dashboardem")).toBe("linear");
    expect(pickSiteStyle("fintech do płatności online")).toBe("stripe");
  });
  it("luksus, gastronomia, fitness, gaming, portfolio", () => {
    expect(pickSiteStyle("ekskluzywny jubiler, zegarki premium")).toBe("luxury");
    expect(pickSiteStyle("przytulna restauracja i kawiarnia")).toBe("editorial");
    expect(pickSiteStyle("siłownia i trener personalny")).toBe("organic");
    expect(pickSiteStyle("studio gier i esport")).toBe("cyberpunk");
    expect(pickSiteStyle("portfolio fotografa")).toBe("minimal");
  });
  it("nieznane → sensowny domyślny SaaS", () => {
    expect(pickSiteStyle("xyz")).toBe("saas");
  });
});

describe("auditSite — audyt SEO/dostępność/UX", () => {
  it("kompletna strona → wysoki wynik", () => {
    const good = `<!doctype html><html lang="pl"><head><title>Test ABC</title>
      <meta name="viewport" content="width=device-width">
      <meta name="description" content="Opis strony dłuższy niż dwadzieścia znaków na pewno">
      <meta property="og:title" content="x"><meta name="twitter:card" content="summary_large_image">
      <script type="application/ld+json">{}</script><style>@media(max-width:600px){a{color:red}}</style></head>
      <body><header></header><main><h1>Tytuł</h1><img src="x" alt="opis"><details>FAQ</details>
      <form></form></main><footer>cookie</footer><script>new IntersectionObserver(()=>{})</script></body></html>`;
    const a = auditSite(good);
    expect(a.score).toBeGreaterThanOrEqual(85);
    expect(a.checks.find((c) => c.label === "schema.org (JSON-LD)")?.ok).toBe(true);
  });
  it("uboga strona → niski wynik i braki", () => {
    const a = auditSite("<html><body><h1>a</h1><h1>b</h1></body></html>");
    expect(a.score).toBeLessThan(40);
    expect(a.missing).toContain("Meta description");
    expect(a.checks.find((c) => c.label === "Dokładnie jeden H1")?.ok).toBe(false);
  });
});

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

describe("Kreator stron — pakiety Start/Pro/Premium (pure)", () => {
  it("trzy pakiety, rosnąca cena, Pro zalecany", () => {
    const p = quotePackages("firma");
    expect(p.map((x) => x.id)).toEqual(["start", "pro", "premium"]);
    expect(p[0].price).toBeLessThan(p[1].price);
    expect(p[1].price).toBeLessThan(p[2].price);
    expect(p.find((x) => x.recommended)?.id).toBe("pro");
  });
  it("sklep: Premium ma integrację płatności; ceny zaokrąglone do 50", () => {
    const p = quotePackages("sklep");
    expect(p[2].features.some((f) => /płatnoś/i.test(f))).toBe(true);
    for (const x of p) expect(x.price % 50).toBe(0);
  });
  it("formatPackages: nazwy, ceny i zalecany w tekście dla klienta", () => {
    const txt = formatPackages(quotePackages("landing"), { business: "Nova" });
    expect(txt).toMatch(/Nova/);
    expect(txt).toMatch(/Start/);
    expect(txt).toMatch(/Pro \(zalecany\)/);
    expect(txt).toMatch(/Premium/);
    expect(txt).toMatch(/zł/);
  });
});
