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

// Warstwa „klasa światowa / pionierska" — techniki i bogactwo, które oddzielają stronę
// nagradzaną od przeciętnej. Doklejana zawsze; podnosi pułap bez psucia niezawodności.
const PREMIUM = [
  "POZIOM PIONIERSKI (to ma robić wrażenie „jak to zrobione?!” — a działać bezbłędnie offline z jednego pliku):",
  "- INTRO/PRELOADER: krótka, elegancka animacja wejścia (np. odsłonięcie nazwy/logo, 0.8–1.2 s), potem płynne ujawnienie strony. Z poszanowaniem prefers-reduced-motion.",
  "- BOGACTWO SEKCJI: dla pełnych witryn 8–12 zróżnicowanych sekcji o różnym rytmie (pełnoekranowe vs gęste, jasne vs ciemne), nie monotonna lista kart.",
  "- RUCH KLASY AWWWARDS: parallax na transform, sticky scroll storytelling, liczniki „od zera” (count-up) przy wejściu, sekwencyjne reveal z opóźnieniami, magnetyczne/animowane przyciski, animowany podpis SVG (stroke-dashoffset).",
  "- TŁO Z CHARAKTEREM: gradient-mesh/aurora, subtelny szum (SVG feTurbulence jako tekstura), świetliste plamy podążające delikatnie kursorem, albo animowana siatka — jeden spójny motyw, nie wszystko naraz.",
  "- DETALE PRO: spójny system w :root (skala typografii, odstępy, promienie, cienie, easingi), stany focus widoczne i estetyczne, idealny kontrast (WCAG AA), :focus-visible, aria-labels, alt-y.",
  "- WYDAJNOŚĆ: obrazy z loading=lazy i sensownymi wymiarami, animacje na transform/opacity (nie layout), will-change oszczędnie, IntersectionObserver zamiast nasłuchu scroll.",
  "- KROPKA NAD i: dopracowana stopka, micro-copy z osobowością, spójne ikony inline SVG, zero martwych linków (kotwice działają), płynne przejścia między sekcjami.",
  "- Jeśli pasuje do tematu: tryb jasny/ciemny wg prefers-color-scheme, przełącznik motywu w czystym JS, zapamiętany w localStorage.",
  "Cel: gość ma pomyśleć „to najlepsza strona w tej branży, jaką widziałem”. Ambitnie, ale ZAWSZE kompletnie i bez błędów w jednym pliku.",
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
  const system = `${BASE}\n\n${PREMIUM}\n\n${KIND_HINTS[kind] || KIND_HINTS.auto}\n\n${STYLE_HINTS[style] || STYLE_HINTS.auto}`;
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

// === Automatyczna wycena (realny rynek PL, 2025/2026) ===

export interface QuoteLine { label: string; min: number; max: number; per?: "mc" | "rok" }
export interface Quote {
  kind: SiteKind;
  oneTime: QuoteLine[];   // koszt jednorazowy (wykonanie)
  recurring: QuoteLine[]; // koszty cykliczne (utrzymanie)
  totalMin: number;       // suma jednorazowa min
  totalMax: number;       // suma jednorazowa max
  marketMin: number;      // rynkowy zakres dla typu (sama strona)
  marketMax: number;
}

// Rynkowe widełki w Polsce za SAMO wykonanie strony (freelancer → mała agencja), w zł.
const MARKET: Record<SiteKind, { min: number; max: number; label: string }> = {
  landing:   { min: 900,  max: 3000,  label: "Landing page (one-page)" },
  portfolio: { min: 900,  max: 3000,  label: "Portfolio" },
  firma:     { min: 2000, max: 6000,  label: "Strona firmowa (kilka sekcji)" },
  sklep:     { min: 3500, max: 15000, label: "Sklep internetowy (e-commerce)" },
  auto:      { min: 1500, max: 5000,  label: "Strona www" },
};

/** Pure: rynkowe widełki cen w Polsce dla wszystkich typów (do pokazania „ile to kosztuje"). */
export function marketRanges(): { kind: SiteKind; label: string; min: number; max: number }[] {
  return (Object.keys(MARKET) as SiteKind[]).filter((k) => k !== "auto").map((k) => ({ kind: k, ...MARKET[k] }));
}

/** Pure: automatyczna wycena pakietu „pod klienta" wg typu i briefu (jednorazowo + cyklicznie). */
export function estimateQuote(kind: SiteKind, brief: ClientBrief = {}): Quote {
  const m = MARKET[kind] || MARKET.auto;
  // Więcej wymaganych sekcji = większa złożoność → podnieś górną granicę wykonania.
  const sectionCount = (brief.sections || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean).length;
  const complexityMax = sectionCount > 4 ? Math.round(m.max * 0.2) : 0;
  const oneTime: QuoteLine[] = [{ label: `Projekt i wykonanie — ${m.label}`, min: m.min, max: m.max + complexityMax }];
  // Treści/copywriting — pełen pakiet, gdy klient nie dostarcza gotowych tekstów.
  oneTime.push({ label: "Treści i copywriting (PL)", min: 300, max: 1500 });
  if (kind === "sklep") oneTime.push({ label: "Integracja płatności (Przelewy24/PayU/Stripe)", min: 500, max: 2000 });
  oneTime.push({ label: "Publikacja online + konfiguracja domeny", min: 150, max: 500 });
  const recurring: QuoteLine[] = [
    { label: "Domena + hosting", min: 120, max: 350, per: "rok" },
    { label: "Opieka i drobne zmiany", min: 80, max: 300, per: "mc" },
  ];
  const totalMin = oneTime.reduce((s, l) => s + l.min, 0);
  const totalMax = oneTime.reduce((s, l) => s + l.max, 0);
  return { kind, oneTime, recurring, totalMin, totalMax, marketMin: m.min, marketMax: m.max };
}

const zl = (n: number) => `${Math.round(n).toLocaleString("pl-PL")} zł`;

/** Pure: czytelna oferta cenowa do wysłania klientowi (PL, z kontekstem rynkowym). */
export function formatQuote(q: Quote, brief: ClientBrief = {}): string {
  const who = brief.business?.trim() ? ` dla ${brief.business.trim()}` : "";
  const lines = [
    `Oferta — strona internetowa${who}`,
    ``,
    `Zakres jednorazowy (wykonanie):`,
    ...q.oneTime.map((l) => `  • ${l.label}: ${zl(l.min)}–${zl(l.max)}`),
    ``,
    `RAZEM (jednorazowo): ${zl(q.totalMin)}–${zl(q.totalMax)}`,
    ``,
    `Koszty cykliczne (utrzymanie):`,
    ...q.recurring.map((l) => `  • ${l.label}: ${zl(l.min)}–${zl(l.max)}/${l.per}`),
    ``,
    `Dla porównania — rynkowo w Polsce taka strona kosztuje zwykle ${zl(q.marketMin)}–${zl(q.marketMax)}.`,
    `Wycena orientacyjna; ostateczna zależy od zakresu i liczby poprawek. Termin: zwykle 3–10 dni roboczych.`,
  ];
  return lines.join("\n");
}

// === Pakiety do wyboru (Start / Pro / Premium) — jak w agencjach, ułatwiają decyzję ===

export type PackageId = "start" | "pro" | "premium";
export interface QuotePackage { id: PackageId; name: string; price: number; recommended?: boolean; features: string[] }

const round50 = (n: number) => Math.round(n / 50) * 50;

/** Pure: trzy pakiety wg typu i briefu — rosnąca cena i zakres, Pro zalecany. */
export function quotePackages(kind: SiteKind, brief: ClientBrief = {}): QuotePackage[] {
  const m = MARKET[kind] || MARKET.auto;
  const bump = (brief.sections || "").split(/[,;]/).filter((x) => x.trim()).length > 4 ? 1.15 : 1;
  const isShop = kind === "sklep";
  const start = round50(m.min * bump);
  const pro = round50(((m.min + m.max) / 2) * 1.1 * bump);
  const premium = round50(m.max * 1.4 * bump);
  return [
    { id: "start", name: "Start", price: start, features: [
      `${isShop ? "Sklep" : "Strona"} wg projektu (w pełni responsywna)`,
      "Podstawowe sekcje i treści startowe",
      "Publikacja online",
      "1 runda poprawek",
    ] },
    { id: "pro", name: "Pro", price: pro, recommended: true, features: [
      "Wszystko ze Start",
      "Copywriting — treści pod SEO",
      "SEO podstawowe (meta, szybkość, mobilność)",
      isShop ? "Koszyk + karty produktów" : "Formularz kontaktowy + animacje wejścia",
      "2 rundy poprawek",
    ] },
    { id: "premium", name: "Premium", price: premium, features: [
      "Wszystko z Pro",
      isShop ? "Integracja płatności (Przelewy24/Stripe) + wysyłka" : "Integracje (newsletter / CRM)",
      "SEO zaawansowane + analityka (GA4)",
      "Grafiki i animacje premium",
      "1 miesiąc opieki gratis",
    ] },
  ];
}

/** Pure: pakiety jako gotowy tekst oferty do wysłania klientowi. */
export function formatPackages(pkgs: QuotePackage[], brief: ClientBrief = {}): string {
  const who = brief.business?.trim() ? ` dla ${brief.business.trim()}` : "";
  const blocks = pkgs.map((p) =>
    [`${p.name}${p.recommended ? " (zalecany)" : ""} — ${zl(p.price)}`, ...p.features.map((f) => `  • ${f}`)].join("\n"),
  );
  return [
    `Pakiety — strona internetowa${who}`,
    ``,
    ...blocks.flatMap((b) => [b, ""]),
    `Ceny jednorazowe (wykonanie). Domena + hosting ~120–350 zł/rok, opcjonalna opieka ~80–300 zł/mc.`,
    `Termin: zwykle 3–10 dni roboczych. Chętnie doprecyzuję zakres pod Państwa potrzeby.`,
  ].join("\n");
}
