// === Social Fit — dopasowanie posta do platformy (Content Studio) ===
// CZYSTY, klient-side. Sprawdza wygenerowany post pod limity konkretnej platformy: długość
// podpisu, próg „…więcej" (ile widać przed zwinięciem) i liczbę hashtagów w sweet-spocie.
// Uzupełnia Virality Optimizer (ten ocenia treść; tu — techniczne dopasowanie). S9-safe.

import type { Platform } from "./contentStudio";

export interface PlatformLimits {
  captionMax: number; // twardy limit znaków
  previewCut: number; // ile znaków widać, zanim treść zwinie się pod „…więcej"
  hashMin: number;
  hashMax: number;
}

export const PLATFORM_LIMITS: Record<Platform, PlatformLimits> = {
  instagram: { captionMax: 2200, previewCut: 125, hashMin: 5, hashMax: 15 },
  facebook: { captionMax: 63206, previewCut: 250, hashMin: 0, hashMax: 3 },
  tiktok: { captionMax: 2200, previewCut: 100, hashMin: 3, hashMax: 5 },
  linkedin: { captionMax: 3000, previewCut: 210, hashMin: 3, hashMax: 5 },
};

export interface SocialFit {
  len: number;
  hashtags: number;
  captionMax: number;
  issues: string[]; // co poprawić pod platformę
}

const PLATFORM_PL: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

/** Pure: policz hashtagi (#słowo, z polskimi znakami). Bez flagi /u — S9-safe. */
export function countHashtags(text: string): number {
  const m = (text || "").match(/#[A-Za-z0-9_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g);
  return m ? m.length : 0;
}

/** Pure: oceń dopasowanie posta do wybranej platformy. */
export function assessSocialFit(platform: Platform, text: string): SocialFit {
  const t = (text || "").trim();
  const lim = PLATFORM_LIMITS[platform];
  const name = PLATFORM_PL[platform];
  const len = t.length;
  const hashtags = countHashtags(t);
  const issues: string[] = [];

  if (len > lim.captionMax) issues.push(`Za długie dla ${name} (${len}/${lim.captionMax} zn.) — skróć, bo część się nie zmieści.`);
  if (len > lim.previewCut) issues.push(`Najważniejsze daj w pierwszych ~${lim.previewCut} znakach — resztę ${name} chowa pod „…więcej".`);
  if (hashtags < lim.hashMin) issues.push(`Mało hashtagów (${hashtags}) — dla ${name} celuj w ${lim.hashMin}–${lim.hashMax}.`);
  else if (hashtags > lim.hashMax) issues.push(`Za dużo hashtagów (${hashtags}) — dla ${name} lepiej ${lim.hashMin}–${lim.hashMax}.`);

  return { len, hashtags, captionMax: lim.captionMax, issues };
}
