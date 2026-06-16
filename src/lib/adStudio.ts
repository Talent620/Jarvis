import { askModel } from "./brain";

// Generator reklam (Faza 0 automatyzacji reklam) — JARVIS pisze gotowe zestawy reklam
// pod Google Ads (wyszukiwarka) i Meta (FB/IG): nagłówki, opisy, słowa kluczowe, CTA,
// pomysły na kreacje, sugerowany budżet. Bez integracji API — kopiujesz i wklejasz w panelu.

export type AdPlatform = "google" | "meta";

export const AD_PLATFORMS: { id: AdPlatform; label: string; emoji: string }[] = [
  { id: "google", label: "Google Ads (wyszukiwarka)", emoji: "🔎" },
  { id: "meta", label: "Facebook / Instagram", emoji: "👍" },
];

export const AD_GOALS = ["sprzedaż", "leady/kontakty", "ruch na stronie", "rozpoznawalność", "telefony"] as const;
export type AdGoal = (typeof AD_GOALS)[number];

export interface AdOpts {
  platform: AdPlatform;
  product: string;
  audience?: string;
  goal?: AdGoal;
  budget?: string;
}

const RULES: Record<AdPlatform, string> = {
  google: [
    "Format Google Ads (sieć wyszukiwania). Zwróć dokładnie sekcje:",
    "1) NAGŁÓWKI: 15 sztuk, każdy MAKS. 30 znaków.",
    "2) OPISY: 4 sztuki, każdy MAKS. 90 znaków.",
    "3) SŁOWA KLUCZOWE: 10–15 trafnych fraz (w dopasowaniu do frazy).",
    "4) WYKLUCZAJĄCE: 5–8 słów wykluczających.",
    "5) BUDŻET: sugerowany budżet dzienny i krótkie uzasadnienie.",
  ].join("\n"),
  meta: [
    "Format Meta (Facebook/Instagram). Zwróć dokładnie sekcje:",
    "1) TEKST GŁÓWNY: 3 warianty (primary text), zwięzłe, mocny pierwszy wers.",
    "2) NAGŁÓWEK: 3 warianty (maks. ~40 znaków).",
    "3) OPIS: 2 warianty.",
    "4) CTA: zaproponuj przycisk (np. Wyślij wiadomość / Kup teraz / Dowiedz się więcej).",
    "5) KREACJE: 3 pomysły na grafikę/wideo.",
    "6) GRUPA DOCELOWA: zainteresowania, wiek, lokalizacja.",
    "7) BUDŻET: sugerowany budżet dzienny i uzasadnienie.",
  ].join("\n"),
};

/** System prompt generatora reklam — zasady pod platformę. */
export function adSystem(platform: AdPlatform): string {
  return [
    "Jesteś ekspertem performance marketingu (po polsku). Tworzysz gotowe do wklejenia reklamy.",
    RULES[platform],
    "ZASADY: konkret i korzyść dla klienta, trzymaj limity znaków, zero clickbaitu i obietnic bez pokrycia.",
    "Zwróć WYŁĄCZNIE gotowe reklamy w podanych sekcjach. Bez wstępu i komentarzy od siebie.",
  ].join("\n");
}

/** User prompt z produktem, odbiorcą, celem i budżetem. Wejście przycinane (obrona przed długim tekstem). */
export function adUserPrompt(o: AdOpts): string {
  const lines = [`Produkt/usługa: ${o.product.trim().slice(0, 2000)}`];
  if (o.audience?.trim()) lines.push(`Grupa docelowa: ${o.audience.trim().slice(0, 500)}`);
  if (o.goal) lines.push(`Cel kampanii: ${o.goal}`);
  if (o.budget?.trim()) lines.push(`Budżet (orientacyjnie): ${o.budget.trim().slice(0, 100)}`);
  return lines.join("\n");
}

/** Wygeneruj zestaw reklam. Pusty string = brak klucza AI lub błąd. */
export async function generateAds(o: AdOpts): Promise<string> {
  if (!o.product?.trim()) return "";
  try {
    // askModel: pełny failover (rotacja kluczy + przełączanie dostawców + retry) — jak czat.
    return (await askModel({ system: adSystem(o.platform), history: [{ role: "user", content: adUserPrompt(o) }], heavy: true })).trim();
  } catch {
    return "";
  }
}
