import { askModel } from "./brain";
import { humanize } from "./aiHelpers";

// Autonomiczny generator stron i SKLEPÓW: z opisu tworzy KOMPLETNĄ, nowoczesną
// witrynę w jednym pliku HTML (wbudowany CSS i JS) na poziomie premium. Działa
// z dowolnym dostawcą AI.

export type SiteKind = "auto" | "landing" | "sklep" | "firma" | "portfolio";
export type SiteStyle = "auto" | "editorial" | "brutalist" | "glass" | "neon" | "retro" | "organic" | "swiss" | "luxury";

const BASE = [
  "Jesteś światowej klasy front-end developerem i dyrektorem artystycznym (poziom Awwwards, nagrody „Site of the Day”). Tworzysz KOMPLETNE, nowoczesne, dopracowane strony w JEDNYM pliku HTML (wbudowany CSS i JavaScript).",
  "",
  "ZASADY (bezwzględne):",
  "- Zwróć WYŁĄCZNIE kod, zaczynając od <!DOCTYPE html>. Bez komentarzy poza kodem, bez bloków ```.",
  "- Bez zewnętrznych bibliotek JS/CSS. Dozwolone wyłącznie Google Fonts przez <link> oraz zdjęcia z https://images.unsplash.com (trafne, tematyczne adresy).",
  "- Kod kompletny i działający od razu po otwarciu w przeglądarce.",
  "- SEO + meta: sensowny <title>, <meta name=description>, Open Graph (og:title/og:description/og:image), favicon jako inline SVG data-URI, lang=pl, znaczniki semantyczne (header/nav/main/section/footer).",
  "",
  "ORYGINALNOŚĆ (kluczowe — to NIE może wyglądać jak typowy szablon AI):",
  "- Zaprojektuj JEDEN mocny motyw przewodni (signature element): charakterystyczny hero, nietypowa siatka, powracający kształt/akcent. Unikaj generycznego układu „hero + 3 karty + cennik”.",
  "- Odważna, przemyślana KOMPOZYCJA: asymetria, nakładanie warstw, celowe łamanie siatki, duże kontrasty skali. Nie środkuj wszystkiego.",
  "- Wyrazista para fontów (np. ekspresyjny nagłówek + czytelny tekst). Detale, których nie ma w przeciętnych stronach.",
  "",
  "POZIOM WIZUALNY (to ma wyglądać jak strona warta tysiące złotych):",
  "- Paleta w zmiennych CSS (:root) z 1–2 kolorami akcentu i subtelnymi gradientami; motyw dobrany do branży/stylu.",
  "- Typografia z charakterem: duży, mocny nagłówek hero (font-size: clamp(...)), wyraźna hierarchia, oddech (duże odstępy, max-width treści).",
  "- Przyklejony, półprzezroczysty nagłówek z efektem rozmycia (backdrop-filter) i nawigacją; płynne przewijanie do sekcji (scroll-behavior: smooth).",
  "- Animacje wejścia przy przewijaniu przez IntersectionObserver (fade/slide-up, z opóźnieniami). Mikrointerakcje: hover na kartach (unoszenie + cień), animowane przyciski, podkreślenia linków.",
  "- Nowoczesne detale: gradientowe lub świetlne tło hero, zaokrąglenia/celowe kanty, miękkie cienie, ikony jako wklejony inline SVG (nie biblioteki).",
  "- W pełni responsywne (mobile-first), z działającym menu mobilnym (hamburger w czystym JS). Uszanuj prefers-reduced-motion.",
  "- REALNA treść po polsku dopasowana do tematu (nie lorem ipsum): chwytliwe nagłówki, konkretne opisy, sensowne CTA.",
].join("\n");

// Niesztampowe kierunki artystyczne — wymuszają wyrazisty, rozpoznawalny charakter (nie „kolejny szablon”).
const STYLE_HINTS: Record<SiteStyle, string> = {
  auto: "KIERUNEK: dobierz oryginalny, niesztampowy styl najlepiej pasujący do branży — i konsekwentnie go pogłęb.",
  editorial: "KIERUNEK: edytorialowy/magazynowy — ekspresyjna typografia szeryfowa, łamanie jak w magazynie, asymetryczna siatka, dużo światła, cienkie linie jako akcent, numerowane sekcje.",
  brutalist: "KIERUNEK: neo-brutalizm — surowe bloki, grube czarne obramowania, twarde cienie (box-shadow bez rozmycia), mocne kontrasty, monospaced akcenty, celowa „surowość”, jaskrawe plamy koloru.",
  glass: "KIERUNEK: glassmorphism — półprzezroczyste, rozmyte panele (backdrop-filter: blur), kolorowy gradient-mesh/poświaty w tle, delikatne obwódki 1px, wyraźna głębia warstw.",
  neon: "KIERUNEK: cyberpunk/neon — ciemne tło, neonowe akcenty (cyan/magenta), świecące krawędzie (glow, text-shadow), siatki perspektywiczne, animowane gradienty, futurystyczny sznyt.",
  retro: "KIERUNEK: retro Y2K/vaporwave — paleta lat 90./2000., chrom i gradienty, geometryczne kształty, grid, śmiała nostalgiczna typografia, playful detale.",
  organic: "KIERUNEK: organiczny — miękkie, płynne kształty (blob SVG), faliste przejścia sekcji (clip-path/SVG), naturalna paleta, łagodne animacje, ciepły, ludzki ton.",
  swiss: "KIERUNEK: szwajcarski/minimal — ścisła siatka, ogromne odstępy, jeden kolor akcentu, czcionka groteskowa, bezwzględny porządek i precyzja, zero zbędnych ozdobników.",
  luxury: "KIERUNEK: luksusowy/premium — czerń + złoto/szampan, eleganckie szeryfy, dużo przestrzeni, wyrafinowane detale i subtelne animacje, aura prestiżu i ekskluzywności.",
};

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
  style: SiteStyle = "auto",
): Promise<{ html: string } | { error: string }> {
  const system = `${BASE}\n\n${KIND_HINTS[kind] || KIND_HINTS.auto}\n\n${STYLE_HINTS[style] || STYLE_HINTS.auto}`;
  const userMsg = current
    ? `Oto obecny kod strony:\n\n${current.slice(0, 14000)}\n\nWprowadź zmianę: ${prompt}\nZwróć PEŁNY, zaktualizowany plik HTML (od <!DOCTYPE html>), zachowując wysoki poziom wizualny i spójny styl.`
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

// === Pełen proces „pod klienta”: brief → strona → wiadomość do klienta ===

export interface ClientBrief {
  business?: string;  // nazwa firmy/marki
  industry?: string;  // branża
  goal?: string;      // cel strony (np. pozyskać klientów, sprzedać kurs)
  audience?: string;  // grupa docelowa
  sections?: string;  // wymagane sekcje
  colors?: string;    // kolory/branding
  contact?: string;   // dane kontaktowe do umieszczenia
  extra?: string;     // dodatkowe życzenia
}

/** Pure: złóż bogaty opis strony ze strukturalnego briefu klienta (puste pola pomijane). */
export function buildClientBrief(b: ClientBrief): string {
  const map: [string | undefined, string][] = [
    [b.business, "Firma/marka"],
    [b.industry, "Branża"],
    [b.goal, "Cel strony"],
    [b.audience, "Grupa docelowa"],
    [b.sections, "Wymagane sekcje"],
    [b.colors, "Kolory/branding"],
    [b.contact, "Dane kontaktowe (umieść w stopce i sekcji kontakt/CTA)"],
    [b.extra, "Dodatkowe życzenia"],
  ];
  return map.filter(([v]) => v && v.trim()).map(([v, label]) => `${label}: ${v!.trim()}`).join("\n");
}

/** Pure: gotowa wiadomość do klienta z demem strony (handover). */
export function clientHandoverMessage(business?: string): string {
  const who = business?.trim() ? ` dla ${business.trim()}` : "";
  return [
    `Dzień dobry,`,
    ``,
    `przygotowałem propozycję nowej strony${who}. W załączniku gotowy plik (.html) — wystarczy otworzyć w przeglądarce, żeby zobaczyć pełny podgląd na żywo (działa też na telefonie).`,
    ``,
    `Co dalej, jeśli się spodoba:`,
    `• publikacja online (mogę postawić ją pod adresem w 1 dzień, hosting od 0 zł),`,
    `• podpięcie własnej domeny i poczty,`,
    `• drobne poprawki tekstów/kolorów/zdjęć wg Państwa uwag,`,
    `• (sklep) podpięcie płatności i wysyłki.`,
    ``,
    `Proszę o słowo, co zmienić — nanoszę poprawki od ręki. Pozdrawiam.`,
  ].join("\n");
}
