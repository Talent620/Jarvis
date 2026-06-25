import { askModel } from "./brain";
import { humanize } from "./aiHelpers";
import { zl } from "./format";

// Autonomiczny generator stron i SKLEPÓW: z opisu tworzy KOMPLETNĄ, nowoczesną
// witrynę w jednym pliku HTML (wbudowany CSS i JS) na poziomie premium. Działa
// z dowolnym dostawcą AI.

export type SiteKind = "auto" | "landing" | "sklep" | "firma" | "portfolio";
export type SiteStyle =
  | "auto" | "editorial" | "brutalist" | "glass" | "neon" | "retro" | "organic" | "swiss" | "luxury"
  // Systemy projektowe klasy światowej (ETAP 3 — AI Design Engine):
  | "apple" | "stripe" | "linear" | "notion" | "tesla" | "airbnb" | "openai" | "saas" | "enterprise" | "cyberpunk" | "minimal";

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
  apple: "KIERUNEK: Apple — skrajny minimalizm premium, ogromne odstępy, wielkie produktowe hero na bieli/czerni, perfekcyjna typografia (Inter/Helvetica Now-like), subtelne, dopracowane animacje przewijania, jeden bohater na sekcję, idealny kontrast i detale.",
  stripe: "KIERUNEK: Stripe — czysty, techniczny, elegancki SaaS: gradientowe kolorowe tła hero (przejścia fioletu/błękitu/zieleni), precyzyjna siatka, subtelne diagramy/ilustracje SVG, znakomita typografia, mikrointerakcje, wrażenie zaawansowania i zaufania.",
  linear: "KIERUNEK: Linear — ciemny, ultra-nowoczesny: głębokie tła, subtelne poświaty i gradient-mesh, ostre detale, monochromia z jednym akcentem, inżynierski sznyt, perfekcyjne odstępy i typografia.",
  notion: "KIERUNEK: Notion — przyjazny, czysty, dokumentowy: dużo bieli, miękkie ilustracje/emoji-akcenty, prosta siatka, czytelna treść, ciepły minimalizm, zero przeładowania.",
  tesla: "KIERUNEK: Tesla — pełnoekranowe, kinowe hero z dużymi zdjęciami produktu, minimalna nawigacja, mocna typografia, czerń/biel + jeden akcent, dramatyczne sekcje na cały ekran, premium i futurystycznie.",
  airbnb: "KIERUNEK: Airbnb — ciepły, ludzki, ufny: zaokrąglone karty, duże zdjęcia lifestyle, miękka paleta z koralowym akcentem, czytelna siatka, przyjazne mikrokopy — świetne na usługi i komercję.",
  openai: "KIERUNEK: OpenAI — czysty, spokojny, badawczy: dużo światła, czarno-biała baza z subtelnym akcentem, prosta elegancka typografia, treściwe, minimalne sekcje, powaga i klarowność.",
  saas: "KIERUNEK: nowoczesny SaaS — hero z mockupem produktu, korzyści z ikonami, social proof (logo, liczby), cennik z wyróżnionym planem, mocne CTA, dynamiczny i konwertujący.",
  enterprise: "KIERUNEK: enterprise/korporacja — poważny, zaufany, profesjonalny: stonowana paleta (granat/grafit + akcent), klarowna struktura, dane i liczby, referencje, akcent na zgodność i bezpieczeństwo, czytelność ponad ozdobniki. Idealne dla kancelarii, finansów, B2B.",
  cyberpunk: "KIERUNEK: cyberpunk — ciemne tło, neon (cyan/magenta), glow, perspektywiczne siatki, glitch-akcenty, futurystyczna typografia, mocny ruch — efektowne dla tech/gaming/krypto.",
  minimal: "KIERUNEK: skrajny minimalizm — biel, jeden akcent, ogromne odstępy, typografia jako główny bohater, zero zbędnych elementów, perfekcyjna hierarchia i oddech.",
};

// ETAP 3 — auto-dobór systemu projektowego z opisu (deterministyczny pierwszy strzał; model dopracowuje).
const STYLE_RULES: [Exclude<SiteStyle, "auto">, RegExp][] = [
  ["enterprise", /kancelari|prawn|adwokat|radc|notari|ksi[eę]gow|finans|ubezpiecz|korporac|enterprise|\bb2b\b|doradztw|audyt/i],
  ["stripe", /p[łl]atno[śs]|fintech|\bbank|invoic|rozlicze|saas finansow/i],
  ["linear", /\bsaas\b|aplikacj|dashboard|platform|software|\bdev|api\b|narz[eę]dzi/i],
  ["luxury", /luksus|premium|jubiler|zegark|apartament|willa|ekskluz|presti[żz]|hotel 5|moda premium|biżuteri/i],
  ["editorial", /restauracj|kawiarni|bistro|kuchni|piekarni|cukierni|\bfood\b|menu|magazyn|blog|wydawnict/i],
  ["organic", /fitness|si[łl]own|trener|\bjoga\b|\bsport|gabinet|\bspa\b|kosmet|uroda|wellness|zdrowi|terapi/i],
  ["cyberpunk", /gaming|\bgr[ay]\b|esport|krypto|\bnft\b|cyber|futur|techno|web3|blockchain/i],
  ["minimal", /portfolio|fotograf|artyst|projektant|architekt|\bdesign/i],
  ["apple", /produkt premium|gad[żz]et|elektronik|hardware|urz[ąa]dzeni/i],
  ["airbnb", /sklep|e-commerce|odzie[żz]|\bbuty\b|turystyk|nocleg|wynajem|us[łl]ug/i],
];

/** Pure: wybierz najlepszy system projektowy dla opisu strony. Domyślnie nowoczesny SaaS. */
export function pickSiteStyle(desc: string): Exclude<SiteStyle, "auto"> {
  const t = (desc || "").toLowerCase();
  for (const [style, re] of STYLE_RULES) if (re.test(t)) return style;
  return "saas";
}

// ETAP 2/6 — pełna, autonomiczna specyfikacja: każdą NOWĄ stronę dostarczamy kompletną, bez dopytywania.
const FULL_SPEC = [
  "KOMPLETNOŚĆ (zawrzyj ZAWSZE, samodzielnie, bez zadawania pytań):",
  "- SEO: trafny <title> (do ~60 zn.), meta description (do ~155 zn.), canonical, lang=pl, semantyczne nagłówki.",
  "- Open Graph (og:title/description/image/type) + Twitter Cards (summary_large_image).",
  "- schema.org JSON-LD w <script type=\"application/ld+json\"> dopasowany do typu (Organization/LocalBusiness/Product/FAQPage).",
  "- Sekcja FAQ jako <details> ORAZ powiązany FAQPage w JSON-LD.",
  "- Dostępny formularz kontaktowy: <label> dla pól, required, aria, walidacja front-end i komunikat sukcesu (bez backendu).",
  "- Wyraźne, powracające CTA (główne w hero + w stopce).",
  "- Cookie banner (RODO) w czystym JS, decyzja zapamiętana w localStorage (akceptuj/odrzuć).",
  "- Skrót Polityki prywatności na stronie (kotwica) + wzmianka o przetwarzaniu danych z formularza.",
  "- Stopka: dane kontaktowe, prawa autorskie, nawigacja, ikony social (inline SVG).",
  "- Dostępność (WCAG AA): dokładnie jeden <h1>, logiczna hierarchia, alt-y, kontrast, :focus-visible, nawigacja klawiaturą.",
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
  style: SiteStyle = "auto",
): Promise<{ html: string } | { error: string }> {
  // ETAP 3: gdy styl „auto" — deterministycznie dobierz system projektowy z opisu (model dopracuje).
  const resolvedStyle: SiteStyle = style === "auto" && !current ? pickSiteStyle(prompt) : style;
  const styleHint = STYLE_HINTS[resolvedStyle] || STYLE_HINTS.auto;
  // FULL_SPEC tylko dla NOWEJ strony (przy edycji nie wymuszamy przebudowy całości).
  const system = current
    ? `${BASE}\n\n${PREMIUM}\n\n${KIND_HINTS[kind] || KIND_HINTS.auto}\n\n${styleHint}`
    : `${BASE}\n\n${PREMIUM}\n\n${FULL_SPEC}\n\n${KIND_HINTS[kind] || KIND_HINTS.auto}\n\n${styleHint}`;
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

// === ETAP 6/8/9 — deterministyczny audyt jakości wygenerowanej strony (SEO/dostępność/UX) ===

export interface SiteAuditCheck { label: string; ok: boolean }
export interface SiteAudit { score: number; checks: SiteAuditCheck[]; missing: string[] }

/** Pure: oceń wygenerowany HTML pod SEO/dostępność/UX. Zwraca wynik 0–100 i listę braków. */
export function auditSite(html: string): SiteAudit {
  const h = html || "";
  const checks: SiteAuditCheck[] = [
    { label: "Tytuł strony", ok: /<title>[^<]{3,}<\/title>/i.test(h) },
    { label: "Meta description", ok: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i.test(h) },
    { label: "Open Graph", ok: /property=["']og:title["']/i.test(h) },
    { label: "Twitter Cards", ok: /name=["']twitter:card["']/i.test(h) },
    { label: "schema.org (JSON-LD)", ok: /application\/ld\+json/i.test(h) },
    { label: "Dokładnie jeden H1", ok: (h.match(/<h1[\s>]/gi)?.length ?? 0) === 1 },
    { label: "Viewport (mobile)", ok: /name=["']viewport["']/i.test(h) },
    { label: "Język (lang)", ok: /<html[^>]+lang=/i.test(h) },
    { label: "Sekcje semantyczne", ok: /<header\b/i.test(h) && /<main\b/i.test(h) && /<footer\b/i.test(h) },
    { label: "Obrazy z alt", ok: !/<img(?![^>]*\balt=)[^>]*>/i.test(h) },
    { label: "Sekcja FAQ", ok: /<details\b/i.test(h) || /\bfaq\b/i.test(h) },
    { label: "Formularz kontaktowy", ok: /<form\b/i.test(h) },
    { label: "Cookie banner (RODO)", ok: /cookie/i.test(h) },
    { label: "Responsywność (media query)", ok: /@media/i.test(h) },
    { label: "Animacje wejścia", ok: /IntersectionObserver|@keyframes|transition/i.test(h) },
  ];
  const ok = checks.filter((c) => c.ok).length;
  return { score: Math.round((ok / checks.length) * 100), checks, missing: checks.filter((c) => !c.ok).map((c) => c.label) };
}

/** ETAP 10 — pętla samodoskonalenia: skrytykuj i podnieś poziom strony (jedno kliknięcie). */
export async function improveSite(html: string, kind: SiteKind = "auto", style: SiteStyle = "auto"): Promise<{ html: string } | { error: string }> {
  const audit = auditSite(html);
  const fix = audit.missing.length ? ` Uzupełnij braki: ${audit.missing.join(", ")}.` : "";
  const instruction =
    "Wciel się w jury Awwwards oraz senior UX/SEO. Znajdź 5 NAJSŁABSZYCH punktów tej strony (design i hierarchia, " +
    "konwersja/CTA, treść, SEO/schema, dostępność) i NAPRAW je, wyraźnie podnosząc poziom — bez obniżania niczego, co już dobre." +
    fix +
    " Zwróć pełną, ulepszoną wersję.";
  return generateSite(instruction, html, kind, style);
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
