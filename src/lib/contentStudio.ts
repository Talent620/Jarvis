import { askModel } from "./brain";
import { store } from "./store";
import { appendBrand } from "./brandKit";

// Maszynka do kontentu — JARVIS pisze gotowy post na social media (hook, treść,
// hashtagi, CTA) dla wybranej platformy. Kopiujesz albo udostępniasz jednym tapnięciem
// do dowolnej apki (IG/FB/TikTok/LinkedIn) — „połączenie mediów" bez kruchych integracji API.

export type Platform = "instagram" | "facebook" | "tiktok" | "linkedin";

export const PLATFORMS: { id: Platform; label: string; emoji: string; hint: string }[] = [
  { id: "instagram", label: "Instagram", emoji: "📸", hint: "post + hashtagi, lekko, emoji" },
  { id: "facebook", label: "Facebook", emoji: "👍", hint: "dłuższy, konwersacyjny, mniej hashtagów" },
  { id: "tiktok", label: "TikTok", emoji: "🎵", hint: "krótko, hak w 1. sekundzie, scenariusz reela" },
  { id: "linkedin", label: "LinkedIn", emoji: "💼", hint: "profesjonalnie, ekspercko, bez przesady z emoji" },
];

export const TONES = ["swobodny", "profesjonalny", "zabawny", "sprzedażowy", "inspirujący"] as const;
export type Tone = (typeof TONES)[number];

export interface ContentOpts {
  platform: Platform;
  topic: string;
  tone?: Tone;
  /** Nazwa firmy/marki — wplatana naturalnie (opcjonalnie). */
  brand?: string;
}

const PLATFORM_RULES: Record<Platform, string> = {
  instagram: "Instagram: mocny pierwszy wers (hak), krótkie akapity, emoji z umiarem, 8–15 trafnych hashtagów na końcu.",
  facebook: "Facebook: ton konwersacyjny, można dłużej, pytanie do odbiorców na końcu, maks. 3–5 hashtagów.",
  tiktok: "TikTok: napisz scenariusz krótkiego reela — hak w 1. sekundzie, 3–5 ujęć/punktów, CTA; dodaj 5–8 hashtagów.",
  linkedin: "LinkedIn: profesjonalnie i ekspercko, konkretna wartość/wniosek, minimum emoji, 3–5 hashtagów branżowych.",
};

/** System prompt dla generatora — zasady pod konkretną platformę. */
export function contentSystem(platform: Platform): string {
  return [
    "Jesteś światowej klasy specjalistą social media (po polsku). Tworzysz gotowe do publikacji posty.",
    PLATFORM_RULES[platform],
    "ZASADY: konkret, zero lania wody, autentycznie, bez clickbaitu i obietnic bez pokrycia.",
    "Zwróć WYŁĄCZNIE gotowy post (treść + hashtagi). Bez komentarzy od siebie, bez nagłówków typu „Oto post”.",
  ].join("\n");
}

/** User prompt z tematem, tonem i marką. Wejście przycinane (obrona przed bardzo długim tekstem). */
export function contentUserPrompt(o: ContentOpts): string {
  const lines = [`Temat posta: ${o.topic.trim().slice(0, 2000)}`];
  if (o.tone) lines.push(`Ton: ${o.tone}`);
  if (o.brand?.trim()) lines.push(`Marka/firma (wpleć naturalnie): ${o.brand.trim().slice(0, 200)}`);
  return lines.join("\n");
}

/** Zapisz wygenerowany post w historii (najnowszy na górze, limit 50). */
export type ContentStatus = NonNullable<import("../types").ContentPost["status"]>;

export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  draft: "Szkic",
  ready: "Gotowe",
  published_manual: "Opublikowane (ręcznie)",
  published_confirmed: "Opublikowane",
  failed: "Błąd publikacji",
};

/** Status posta (brak = draft — samo wygenerowanie nie jest publikacją). */
export function contentStatusOf(p: import("../types").ContentPost): ContentStatus {
  return p.status || "draft";
}

/** Czy post jest realnie opublikowany (ręcznie potwierdzony lub przez API)? */
export function isPublished(p: import("../types").ContentPost): boolean {
  const s = contentStatusOf(p);
  return s === "published_manual" || s === "published_confirmed";
}

export function saveContentPost(platform: string, topic: string, text: string) {
  if (!text.trim()) return;
  store.setData((d) => {
    if (!d.contentPosts) d.contentPosts = [];
    // Nowy post = SZKIC. Publikacja wymaga osobnego, jawnego potwierdzenia.
    d.contentPosts.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, platform, topic, text, at: Date.now(), status: "draft" });
    if (d.contentPosts.length > 50) d.contentPosts.length = 50;
  });
}

/** Oznacz post jako opublikowany ręcznie (jawne potwierdzenie użytkownika). */
export function markContentPublished(id: string, now = Date.now()): void {
  store.setData((d) => {
    const p = (d.contentPosts || []).find((x) => x.id === id);
    if (p) { p.status = "published_manual"; p.publishedAt = now; }
  });
}

/** Wygeneruj gotowy post. Pusty string = brak klucza AI lub błąd. */
export async function generatePost(o: ContentOpts): Promise<string> {
  if (!o.topic?.trim()) return "";
  try {
    return (await askModel({ system: appendBrand(contentSystem(o.platform)), history: [{ role: "user", content: contentUserPrompt(o) }], heavy: true })).trim();
  } catch {
    return "";
  }
}
