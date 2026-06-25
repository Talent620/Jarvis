// === Ad Quality / Policy scorer (Creative OS) ===
// CZYSTY, klient-side. Ocenia WYGENEROWANĄ reklamę pod kątem RYZYKA ODRZUCENIA przez
// Google/Meta i siły przekazu: limit znaków nagłówków, KAPITALIKI, nadmiar !/?, ryzykowne
// zwroty (obietnice/superlatywy), emoji w Google Ads, brak CTA. Wynik 0–100 (wyżej = lepiej).
// Nieinwazyjne: tylko czyta tekst, niczego nie generuje. S9-safe (bez /u i lookbehind).

import type { AdPlatform } from "./adStudio";

export type AdRisk = "low" | "medium" | "high";
export interface AdQuality {
  score: number; // 0–100, wyżej = mniejsze ryzyko odrzucenia
  risk: AdRisk;
  issues: string[]; // co poprawić
  wins: string[]; // co już jest dobrze
}

// Limit znaków nagłówka wg platformy (Google: 30, Meta ~40).
const HEADLINE_MAX: Record<AdPlatform, number> = { google: 30, meta: 40 };

// Zwroty często odrzucane lub osłabiające reklamę (małe litery — porównujemy na lowercase).
const RISKY = [
  "gwarantujemy", "gwarancja sukcesu", "100% skuteczn", "najlepszy na rynku", "najlepsza na rynku",
  "najlepsi na rynku", "numer 1", "nr 1", "#1", "lider rynku", "rewolucyjny", "cudowny", "magiczny",
  "kliknij tutaj", "kliknij teraz", "szybki zarobek", "zarabiaj od zaraz", "bez ryzyka", "100% gwarancji",
];

// CTA — dystynktywne rdzenie czasowników wzywających do działania (PL + zapis bez ogonków).
const CTA_STEMS = [
  "zadzwo", "napisz", "zamów", "zamow", "sprawdź", "sprawdz", "odbierz", "umów", "umow",
  "wypełnij", "wypelnij", "pobierz", "zarezerw", "dowiedz si", "skorzyst", "wyceń", "wycen",
  "zapytaj", "kup teraz", "kup już", "kup juz", "kupuj",
];

// Akronimy, których NIE traktujemy jak „krzyczących" kapitalików.
const ACRONYMS = new Set(["CTA", "SEO", "PLN", "VAT", "RTV", "AGD", "FAQ", "HD", "4K", "B2B", "B2C", "USP", "ROI", "AI", "PPC", "CRM"]);

// Emoji (pary surogatów) — S9-safe, bez flagi /u.
const EMOJI = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

/** Pure: wyłuskaj pozycje listy pod nagłówkiem sekcji (np. „NAGŁÓWKI:"). Best-effort. */
export function listItemsUnder(text: string, headerRe: RegExp): string[] {
  const lines = (text || "").split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    // Nagłówek sekcji musi mieć dwukropek (np. „NAGŁÓWKI:") — inaczej zwykły tekst zawierający
    // słowo „nagłówek" błędnie udawałby początek sekcji.
    if (headerRe.test(line) && line.includes(":")) { inSection = true; continue; }
    if (!inSection) continue;
    // Koniec sekcji: kolejny nagłówek WIELKIMI literami z dwukropkiem (np. „OPISY:", „2) SŁOWA KLUCZOWE:").
    if (/^\d*[).]?\s*[A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ \-/]{2,}:/.test(line)) break;
    if (!line) { if (out.length) break; else continue; }
    // Zdejmij numerację/punktor i cudzysłowy brzegowe.
    const item = line.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").replace(/^["„»]+|["”«]+$/g, "").trim();
    if (item) out.push(item);
  }
  return out;
}

/** Pure: oceń tekst reklamy pod kątem ryzyka odrzucenia i siły przekazu. */
export function scoreAdCopy(platform: AdPlatform, text: string): AdQuality {
  const issues: string[] = [];
  const wins: string[] = [];
  const t = (text || "").trim();
  if (!t) return { score: 0, risk: "high", issues: ["Brak treści reklamy."], wins: [] };
  const low = t.toLowerCase();

  // 1) Limit znaków nagłówków (tylko gdy PEWNIE wykryto listę nagłówków — ≥3 pozycje).
  const max = HEADLINE_MAX[platform];
  const heads = listItemsUnder(t, /nag[łl][óo]w(ek|ki)|headline/i);
  if (heads.length >= 3) {
    const over = heads.filter((h) => h.length > max);
    if (over.length) issues.push(`${over.length} nagłówk(ów) > limit ${max} znaków (np. „${over[0].slice(0, 40)}…") — ${platform === "google" ? "Google" : "Meta"} je obetnie.`);
    else wins.push(`Nagłówki mieszczą się w limicie ${max} znaków.`);
  }

  // 2) KAPITALIKI — słowa pisane w całości wielkimi literami (poza akronimami).
  const words = t.split(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9]+/).filter(Boolean);
  const caps = words.filter((w) => w.length >= 3 && !/[0-9]/.test(w) && w === w.toUpperCase() && /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(w) && !ACRONYMS.has(w));
  if (caps.length >= 3) issues.push(`Za dużo KAPITALIKÓW (${caps.length} słów) — platformy odrzucają nadmierne wielkie litery.`);

  // 3) Nadmiar wykrzykników/znaków interpunkcyjnych.
  const bangs = (t.match(/!/g) || []).length;
  if (/!{2,}|\?{2,}/.test(t) || bangs > 3) issues.push("Nadmiar wykrzykników/znaków — ogranicz (najlepiej jeden wykrzyknik na całość).");

  // 4) Ryzykowne zwroty / obietnice bez pokrycia.
  const hits = RISKY.filter((w) => low.includes(w));
  if (hits.length) issues.push(`Ryzykowne zwroty (mogą wstrzymać reklamę): ${hits.slice(0, 4).join(", ")}.`);

  // 5) Emoji w Google Ads — niedozwolone w tekście.
  const emoji = (t.match(EMOJI) || []).length;
  if (platform === "google" && emoji > 0) issues.push(`Emoji (${emoji} szt.) — Google Ads nie zezwala na emoji w tekście reklamy.`);

  // 6) CTA — wezwanie do działania.
  if (CTA_STEMS.some((s) => low.includes(s))) wins.push("Jest wyraźne wezwanie do działania (CTA).");
  else issues.push("Brak wyraźnego CTA (np. Zadzwoń, Sprawdź, Zamów, Wyceń).");

  const score = Math.max(0, Math.min(100, 100 - issues.length * 16));
  const risk: AdRisk = score >= 80 ? "low" : score >= 55 ? "medium" : "high";
  return { score, risk, issues, wins };
}

/** Pure: krótka etykieta do badge'a. */
export function adQualityLabel(q: AdQuality): string {
  const r = q.risk === "low" ? "niskie ryzyko" : q.risk === "medium" ? "średnie ryzyko" : "wysokie ryzyko";
  return `Jakość reklamy: ${q.score}/100 (${r} odrzucenia)`;
}
