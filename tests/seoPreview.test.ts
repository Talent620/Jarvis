import { describe, it, expect } from "vitest";
import { extractMeta, assessSeo } from "../src/lib/seoPreview";

const HTML = `<!doctype html><html><head>
  <title>Strony internetowe dla firm — V-AI Kraków</title>
  <meta name="description" content="Tworzymy nowoczesne, szybkie strony i sklepy dla lokalnych firm. Wycena w 24h, płatność po akceptacji. Zadzwoń i sprawdź ofertę już dziś.">
  <meta property="og:title" content="V-AI — strony, które sprzedają">
  <meta content="Nowoczesne strony dla firm" property="og:description">
  <meta property="og:image" content="https://v-ai.pl/og.png">
  <link rel="canonical" href="https://v-ai.pl/">
</head><body></body></html>`;

describe("seoPreview — extractMeta", () => {
  it("wyłuskuje title, description, OG (oba szyki atrybutów) i canonical", () => {
    const m = extractMeta(HTML);
    expect(m.title).toMatch(/Strony internetowe dla firm/);
    expect(m.description).toMatch(/Tworzymy nowoczesne/);
    expect(m.ogTitle).toBe("V-AI — strony, które sprzedają");
    expect(m.ogDescription).toBe("Nowoczesne strony dla firm"); // content przed property
    expect(m.ogImage).toBe("https://v-ai.pl/og.png");
    expect(m.canonical).toBe("https://v-ai.pl/");
  });
});

describe("seoPreview — assessSeo", () => {
  it("kompletne meta → brak uwag", () => {
    expect(assessSeo(HTML).issues).toHaveLength(0);
  });

  it("brak meta → konkretne braki", () => {
    const r = assessSeo("<html><head></head><body></body></html>");
    expect(r.issues.some((i) => /title/i.test(i))).toBe(true);
    expect(r.issues.some((i) => /description/i.test(i))).toBe(true);
    expect(r.issues.some((i) => /Open Graph/i.test(i))).toBe(true);
    expect(r.issues.some((i) => /og:image/i.test(i))).toBe(true);
  });

  it("za długi tytuł i opis → ostrzeżenie o ucięciu", () => {
    const long = `<title>${"x".repeat(80)}</title><meta name="description" content="${"y".repeat(200)}">`;
    const r = assessSeo(long);
    expect(r.issues.some((i) => /Tytuł za długi/.test(i))).toBe(true);
    expect(r.issues.some((i) => /Opis za długi/.test(i))).toBe(true);
  });
});
