import { askModel } from "./brain";
import { humanize } from "./aiHelpers";

// Autonomiczny generator stron i SKLEPÓW: z opisu tworzy KOMPLETNĄ, nowoczesną
// witrynę w jednym pliku HTML (wbudowany CSS i JS) na poziomie premium. Działa
// z dowolnym dostawcą AI.

export type SiteKind = "auto" | "landing" | "sklep" | "firma" | "portfolio";

const BASE = [
  "Jesteś światowej klasy front-end developerem i dyrektorem artystycznym (poziom Awwwards). Tworzysz KOMPLETNE, nowoczesne, dopracowane strony w JEDNYM pliku HTML (wbudowany CSS i JavaScript).",
  "",
  "ZASADY (bezwzględne):",
  "- Zwróć WYŁĄCZNIE kod, zaczynając od <!DOCTYPE html>. Bez komentarzy poza kodem, bez bloków ```.",
  "- Bez zewnętrznych bibliotek JS/CSS. Dozwolone wyłącznie Google Fonts przez <link> oraz zdjęcia z https://images.unsplash.com (trafne, tematyczne adresy).",
  "- Kod kompletny i działający od razu po otwarciu w przeglądarce.",
  "",
  "POZIOM WIZUALNY (to ma wyglądać jak strona warta tysiące złotych):",
  "- Paleta w zmiennych CSS (:root). Domyślnie elegancki, ciemny motyw z 1–2 kolorami akcentu i subtelnymi gradientami; jasny tylko gdy temat tego wymaga.",
  "- Typografia z charakterem: duży, mocny nagłówek hero (font-size: clamp(...)), wyraźna hierarchia, oddech (duże odstępy, max-width treści).",
  "- Przyklejony, półprzezroczysty nagłówek z efektem rozmycia (backdrop-filter) i nawigacją; płynne przewijanie do sekcji (scroll-behavior: smooth).",
  "- Animacje wejścia przy przewijaniu przez IntersectionObserver (fade/slide-up, z opóźnieniami). Mikrointerakcje: hover na kartach (unoszenie + cień), animowane przyciski, podkreślenia linków.",
  "- Nowoczesne detale: gradientowe lub świetlne tło hero, zaokrąglenia, miękkie cienie, ikony jako wklejony inline SVG (nie biblioteki).",
  "- W pełni responsywne (mobile-first), z działającym menu mobilnym (hamburger w czystym JS). Uszanuj prefers-reduced-motion.",
  "- REALNA treść po polsku dopasowana do tematu (nie lorem ipsum): chwytliwe nagłówki, konkretne opisy, sensowne CTA.",
].join("\n");

const KIND_HINTS: Record<SiteKind, string> = {
  auto: "Dobierz układ i sekcje najlepiej pasujące do opisu.",
  landing: [
    "TYP: landing page produktu/usługi. Sekcje: hero z mocnym hasłem i CTA, pasek zaufania/logotypy,",
    "korzyści (siatka kart z ikonami SVG), jak to działa (kroki), opinie klientów, cennik (2–3 plany z wyróżnionym),",
    "FAQ (rozwijane <details>), sekcja CTA, stopka z kontaktem.",
  ].join("\n"),
  sklep: [
    "TYP: SKLEP INTERNETOWY (e-commerce front-end). Wymagane:",
    "- siatka 6–9 produktów (karty: zdjęcie, nazwa, krótki opis, CENA w zł, przycisk Dodaj do koszyka),",
    "- DZIAŁAJĄCY koszyk w czystym JS: licznik sztuk w nagłówku (badge), wysuwany panel koszyka (drawer) z listą pozycji,",
    "  zmianą ilości, usuwaniem, sumą częściową i przyciskiem Przejdź do kasy (placeholder z informacją o podpięciu płatności),",
    "- filtr/kategorie lub sekcje, sekcja bestsellery/wyróżnione, pasek dostawa/zwroty/gwarancja, newsletter, stopka.",
    "Dane produktów realistyczne dla branży z opisu. Stan koszyka trzymaj w JS (tablica), bez backendu.",
  ].join("\n"),
  firma: [
    "TYP: strona firmowa. Sekcje: hero z propozycją wartości, o firmie, usługi (siatka),",
    "realizacje/portfolio, zespół, opinie, proces współpracy, kontakt z formularzem (front-end) i mapą placeholder, stopka z danymi.",
  ].join("\n"),
  portfolio: [
    "TYP: portfolio. Sekcje: hero z imieniem i specjalizacją, galeria prac (siatka z hover),",
    "o mnie, umiejętności, doświadczenie/oś czasu, kontakt. Estetyka minimalistyczna, mocna typografia.",
  ].join("\n"),
};

function extractHtml(text: string): string {
  let s = (text || "").trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const i = s.search(/<!doctype html|<html/i);
  if (i >= 0) s = s.slice(i);
  return s.includes("<") ? s : "";
}

export async function generateSite(
  prompt: string,
  current?: string,
  kind: SiteKind = "auto",
): Promise<{ html: string } | { error: string }> {
  const system = `${BASE}\n\n${KIND_HINTS[kind] || KIND_HINTS.auto}`;
  const userMsg = current
    ? `Oto obecny kod strony:\n\n${current.slice(0, 14000)}\n\nWprowadź zmianę: ${prompt}\nZwróć PEŁNY, zaktualizowany plik HTML (od <!DOCTYPE html>), zachowując wysoki poziom wizualny.`
    : `Zbuduj stronę według opisu: ${prompt}`;

  try {
    const reply = await askModel({ system, history: [{ role: "user", content: userMsg }], heavy: true });
    const html = extractHtml(reply || "");
    if (!html) return { error: "Model nie zwrócił kodu HTML — spróbuj doprecyzować opis." };
    return { html };
  } catch (e) {
    return { error: humanize(e instanceof Error ? e.message : String(e)) };
  }
}
