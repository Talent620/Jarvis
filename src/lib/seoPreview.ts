// === SEO/SERP + social preview (Web Studio) ===
// CZYSTY, klient-side. Wyłuskuje meta z wygenerowanego HTML i ocenia, jak strona wygląda w
// Google (snippet) oraz przy udostępnieniu (karta Open Graph). Flaguje za długie/krótkie title
// i description (Google ucina), brak og:image itd. Bez API. S9-safe (bez /u i lookbehind).

export interface PageMeta {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  canonical: string;
}

export interface SeoCheck {
  meta: PageMeta;
  issues: string[]; // co poprawić pod SEO/udostępnianie
  titleLen: number;
  descLen: number;
}

/** Pure: wytnij zawartość atrybutu content z taga meta po nazwie/property. */
function metaContent(html: string, key: string, attr: "name" | "property"): string {
  // Dwa szyki atrybutów: <meta name=".." content=".."> oraz <meta content=".." name="..">.
  const k = key.replace(/[-]/g, "\\-");
  const re1 = new RegExp(`<meta[^>]*${attr}\\s*=\\s*["']${k}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*${attr}\\s*=\\s*["']${k}["']`, "i");
  const m = html.match(re1) || html.match(re2);
  return m ? m[1].trim() : "";
}

/** Pure: wyłuskaj meta SEO/OG z HTML. */
export function extractMeta(html: string): PageMeta {
  const h = html || "";
  const titleM = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const canonM = h.match(/<link[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']*)["']/i);
  return {
    title: titleM ? titleM[1].replace(/\s+/g, " ").trim() : "",
    description: metaContent(h, "description", "name"),
    ogTitle: metaContent(h, "og:title", "property"),
    ogDescription: metaContent(h, "og:description", "property"),
    ogImage: metaContent(h, "og:image", "property"),
    canonical: canonM ? canonM[1].trim() : "",
  };
}

/** Pure: oceń meta pod kątem wyświetlania w Google i udostępniania (lista konkretnych braków). */
export function assessSeo(html: string): SeoCheck {
  const meta = extractMeta(html);
  const issues: string[] = [];
  const titleLen = meta.title.length;
  const descLen = meta.description.length;

  if (!meta.title) issues.push("Brak <title> — Google nie ma czego pokazać w wynikach.");
  else if (titleLen > 60) issues.push(`Tytuł za długi (${titleLen} zn.) — Google utnie po ~60. Skróć.`);
  else if (titleLen < 20) issues.push(`Tytuł krótki (${titleLen} zn.) — dodaj słowa kluczowe i korzyść.`);

  if (!meta.description) issues.push("Brak meta description — Google sam wytnie losowy fragment.");
  else if (descLen > 160) issues.push(`Opis za długi (${descLen} zn.) — Google utnie po ~155. Skróć.`);
  else if (descLen < 70) issues.push(`Opis krótki (${descLen} zn.) — wykorzystaj ~150 znaków z korzyścią i CTA.`);

  if (!meta.ogTitle && !meta.ogDescription) issues.push("Brak Open Graph (og:title/og:description) — przy udostępnieniu link wygląda ubogo.");
  if (!meta.ogImage) issues.push("Brak og:image — udostępniony link nie pokaże miniatury (mniej kliknięć).");

  return { meta, issues, titleLen, descLen };
}
