// === UTM Builder — linki z tagami kampanii do mierzenia ROI ===
// CZYSTY, klient-side. Dokleja utm_source/medium/campaign/term/content do linku, żeby w Google
// Analytics / panelu reklam było widać, KTÓRA reklama, post czy link w bio daje ruch i sprzedaż.
// Działa dla wszystkich obszarów: reklamy (Google/Meta), social (IG/FB/TikTok/LinkedIn), newsletter.
// S9-safe (bez /u i lookbehind).

export interface UtmInput {
  url: string;
  source: string;
  medium: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface UtmPreset {
  id: string;
  label: string;
  source: string;
  medium: string;
}

// Gotowe kombinacje source+medium wg dobrych praktyk GA4 — pokrywają reklamy, social i e-mail.
export const UTM_PRESETS: UtmPreset[] = [
  { id: "google-cpc", label: "🔎 Google Ads", source: "google", medium: "cpc" },
  { id: "meta-paid", label: "👍 FB/IG — płatne", source: "facebook", medium: "paid_social" },
  { id: "instagram-bio", label: "📸 Instagram — bio/post", source: "instagram", medium: "social" },
  { id: "facebook-post", label: "👍 Facebook — post", source: "facebook", medium: "social" },
  { id: "tiktok", label: "🎵 TikTok", source: "tiktok", medium: "social" },
  { id: "linkedin", label: "💼 LinkedIn", source: "linkedin", medium: "social" },
  { id: "newsletter", label: "✉ Newsletter", source: "newsletter", medium: "email" },
];

/** Pure: doprowadź adres do działającej postaci (dołóż https:// gdy brak schematu). */
export function normalizeUrl(raw: string): string {
  const u = (raw || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return "https://" + u.replace(/^\/+/, "");
}

/** Pure: znormalizuj wartość taga (małe litery dla source/medium, spacje → myślniki). */
function tagValue(v: string, lower: boolean): string {
  let t = (v || "").trim();
  if (lower) t = t.toLowerCase();
  return t.replace(/\s+/g, "-");
}

/** Pure: zbuduj link z tagami UTM. Zachowuje istniejące query i #hash, pomija puste tagi. */
export function buildUtmUrl(p: UtmInput): string {
  const base = normalizeUrl(p.url);
  if (!base) return "";
  const hashIdx = base.indexOf("#");
  const hash = hashIdx >= 0 ? base.slice(hashIdx) : "";
  const noHash = hashIdx >= 0 ? base.slice(0, hashIdx) : base;

  const pairs: string[] = [];
  const add = (k: string, v: string | undefined, lower = false) => {
    const t = tagValue(v || "", lower);
    if (t) pairs.push(`${k}=${encodeURIComponent(t)}`);
  };
  add("utm_source", p.source, true);
  add("utm_medium", p.medium, true);
  add("utm_campaign", p.campaign);
  add("utm_term", p.term);
  add("utm_content", p.content);
  if (!pairs.length) return base;

  const qs = pairs.join("&");
  const sep = noHash.includes("?") ? (/[?&]$/.test(noHash) ? "" : "&") : "?";
  return `${noHash}${sep}${qs}${hash}`;
}

/** Pure: czego brakuje, by link był poprawny (do UI). Pusta lista = gotowe. */
export function utmIssues(p: UtmInput): string[] {
  const out: string[] = [];
  if (!normalizeUrl(p.url)) out.push("Podaj adres strony (np. www.v-ai.pl).");
  if (!(p.source || "").trim()) out.push("Wybierz źródło (np. google, instagram).");
  if (!(p.medium || "").trim()) out.push("Wybierz medium (np. cpc, social, email).");
  return out;
}
