// === Pliki SEO technicznego: robots.txt + sitemap.xml (Kreator stron) ===
// CZYSTE, klient-side. Generuje gotowe robots.txt i sitemap.xml do wgrania obok strony.
// Ścieżki do sitemapy wyłuskujemy z linków w HTML (pomijając kotwice #, mailto, tel, linki zewn.).
// S9-safe (bez /u i lookbehind).

/** Pure: znormalizuj domenę (bez protokołu, bez końcowego ukośnika, bez spacji). */
export function normalizeDomain(input: string): string {
  return (input || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim();
}

/** Pure: wyłuskaj wewnętrzne ścieżki-strony z HTML (do sitemapy). Zawsze zawiera "/". */
export function extractInternalPaths(html: string): string[] {
  const paths = new Set<string>(["/"]);
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || "")) !== null) {
    const href = m[1].trim();
    if (!href) continue;
    if (/^(https?:|mailto:|tel:|javascript:|data:)/i.test(href)) continue; // zewnętrzne/akcje
    if (href.startsWith("#")) continue; // kotwica w obrębie strony — nie osobna strona
    // Zostaw tylko realne ścieżki-strony (z / albo .html); odetnij część #...
    const clean = href.split("#")[0].trim();
    if (!clean) continue;
    if (clean.startsWith("/") || /\.html?$/i.test(clean)) {
      paths.add(clean.startsWith("/") ? clean : `/${clean}`);
    }
  }
  return [...paths];
}

/** Pure: zbuduj robots.txt (zezwól na indeksację + wskaż sitemapę). */
export function buildRobotsTxt(domain: string): string {
  const d = normalizeDomain(domain);
  const sitemap = d ? `\n\nSitemap: https://${d}/sitemap.xml` : "";
  return `User-agent: *\nAllow: /${sitemap}\n`;
}

/** Pure: zbuduj sitemap.xml z domeny i listy ścieżek. */
export function buildSitemapXml(domain: string, paths: string[], lastmod?: string): string {
  const d = normalizeDomain(domain) || "twojadomena.pl";
  const date = (lastmod || "").trim();
  const urls = (paths.length ? paths : ["/"])
    .map((p) => {
      const loc = `https://${d}${p.startsWith("/") ? p : `/${p}`}`;
      return `  <url>\n    <loc>${loc}</loc>${date ? `\n    <lastmod>${date}</lastmod>` : ""}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
