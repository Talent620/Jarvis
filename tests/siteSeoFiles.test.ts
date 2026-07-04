import { describe, it, expect } from "vitest";
import { normalizeDomain, extractInternalPaths, buildRobotsTxt, buildSitemapXml } from "../src/lib/siteSeoFiles";

describe("siteSeoFiles — normalizeDomain", () => {
  it("usuwa protokół, spacje i końcowy ukośnik", () => {
    expect(normalizeDomain("https://v-ai.pl/")).toBe("v-ai.pl");
    expect(normalizeDomain("  http://X.pl  ")).toBe("X.pl");
    expect(normalizeDomain("v-ai.pl")).toBe("v-ai.pl");
  });
});

describe("siteSeoFiles — extractInternalPaths", () => {
  it("zbiera ścieżki wewnętrzne, pomija kotwice/mailto/zewnętrzne, zawsze ma /", () => {
    const html = `
      <a href="#kontakt">kotwica</a>
      <a href="/oferta">oferta</a>
      <a href="cennik.html">cennik</a>
      <a href="mailto:x@y.pl">mail</a>
      <a href="https://google.com">zewn</a>
      <a href="/blog#wpis">blog z kotwicą</a>`;
    const p = extractInternalPaths(html);
    expect(p).toContain("/");
    expect(p).toContain("/oferta");
    expect(p).toContain("/cennik.html");
    expect(p).toContain("/blog");
    expect(p).not.toContain("#kontakt");
    expect(p.some((x) => /google/.test(x))).toBe(false);
    expect(p.some((x) => /mailto/.test(x))).toBe(false);
  });
});

describe("siteSeoFiles — robots.txt", () => {
  it("zezwala na indeksację i wskazuje sitemapę", () => {
    const r = buildRobotsTxt("v-ai.pl");
    expect(r).toMatch(/User-agent: \*/);
    expect(r).toMatch(/Allow: \//);
    expect(r).toMatch(/Sitemap: https:\/\/v-ai\.pl\/sitemap\.xml/);
  });
  it("bez domeny — nie dokleja linii Sitemap", () => {
    expect(buildRobotsTxt("")).not.toMatch(/Sitemap:/);
  });
});

describe("siteSeoFiles — sitemap.xml", () => {
  it("buduje poprawny XML z pełnymi URL-ami", () => {
    const xml = buildSitemapXml("v-ai.pl", ["/", "/oferta"], "2026-06-25");
    expect(xml).toMatch(/<\?xml version="1.0"/);
    expect(xml).toContain("<loc>https://v-ai.pl/</loc>");
    expect(xml).toContain("<loc>https://v-ai.pl/oferta</loc>");
    expect(xml).toContain("<lastmod>2026-06-25</lastmod>");
  });
  it("pusta lista ścieżek → sama strona główna", () => {
    const xml = buildSitemapXml("v-ai.pl", []);
    expect(xml).toContain("<loc>https://v-ai.pl/</loc>");
  });
});
