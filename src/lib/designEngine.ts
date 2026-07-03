// === Premium Web Design Engine — silnik promptu projektowego klasy Awwwards ===
// PO CO: przeciętna strona „wygląda skończona", premium „czuje się zamierzona". Ten moduł
// przenosi generator stron z poziomu „ładny szablon" na metodologię studia projektowego:
// zakotwiczenie w TEMACIE (nie w modzie), design tokens PRZED kodem, pacing scrolla jako
// narracja, ruch z POWŚCIĄGLIWOŚCIĄ, copy jako materiał projektowy i samokrytyka przed
// oddaniem. Zawiera ANTI-TEMPLATE GUARD — jawny zakaz trzech domyślnych „AI-looków".
// Rdzeń metodologii jest PO ANGIELSKU (modele osiągają najlepsze wyniki designerskie w EN);
// treść generowanych stron pozostaje PO POLSKU (twarda zasada pliku).
// Czyste funkcje (składanie promptu, parsowanie tokenów) — testowalne bez sieci. S9-safe.

export interface DesignTokenColor {
  name: string;
  hex: string; // zawsze zwalidowany #rgb/#rrggbb — bezpieczny do inline style w UI
}

export interface DesignTokens {
  /** 3 przymiotniki-uczucia (np. „assured, quiet, expensive") — test każdej decyzji. */
  feeling: string[];
  colors: DesignTokenColor[];
  type: { display?: string; body?: string; mono?: string };
  space?: string;
  /** JEDEN element, po którym strona ma zostać zapamiętana + „dlaczego" (2 zdania). */
  signature: { element: string; why: string };
}

/** Znacznik komentarza z tokenami wewnątrz wygenerowanego HTML (przeżywa zapis/szkice). */
export const DESIGN_TOKENS_MARK = "DESIGN-TOKENS";

// — Twarde zasady pliku (operacyjne; przeniesione z dawnego BASE webgen.ts) —
// Obowiązują ZAWSZE (nowa strona i edycja) — to kontrakt potoku, nie filozofia.
const HARD_RULES = [
  "ZASADY PLIKU (bezwzględne):",
  "- Zwróć WYŁĄCZNIE kod, zaczynając od <!DOCTYPE html>. Bez komentarzy poza kodem, bez bloków ```.",
  "- JEDEN plik HTML z wbudowanym CSS i JavaScript. Bez zewnętrznych bibliotek JS/CSS. Dozwolone wyłącznie Google Fonts przez <link> oraz zdjęcia z https://images.unsplash.com (trafne, tematyczne adresy).",
  "- Kod kompletny i działający od razu po otwarciu w przeglądarce.",
  "- W pełni responsywnie (mobile-first, sprawdź do 360px szerokości), z działającym menu mobilnym w czystym JS.",
  "- REALNA treść PO POLSKU dopasowana do tematu (nie lorem ipsum), chyba że brief wprost każe inaczej.",
  "- Podłoga jakości zawsze: semantyczne znaczniki, kontrast tekstu ≥ 4.5:1, widoczne :focus-visible, alt-y obrazów, animacje wyłącznie na transform/opacity, loading=lazy poniżej pierwszego ekranu, font-display: swap, zero przesunięć layoutu w hero.",
  "- Przetestuj ciemne zakamarki: długie nagłówki, brakujące obrazy, 320px szerokości.",
].join("\n");

// — Rdzeń metodologii (EN; adaptacja: bez zewnętrznych bibliotek, tokeny zapisywane W pliku,
//   hierarchia Brand Kit > temat > moda, blueprint steruje STRUKTURĄ, filozofia WYKONANIEM) —
const PHILOSOPHY = `# ROLE
You are the design lead of a small, award-winning web studio (Awwwards / FWA caliber). Clients come to you specifically because they have already rejected work that felt templated. You are not a code generator that decorates pages — you are a designer who happens to write production-grade code. Take the brief and produce a website that reads as PREMIUM, not average.

# CORE PHILOSOPHY — AVERAGE VS PREMIUM
- Average websites give people information. Premium websites create a feeling.
- An average website can look clean and still feel forgettable — nice colors, good fonts, modern layout, and yet it feels like every other site online.
- Premium design lives in: the spacing, the pacing, the way each section flows into the next, the way motion is used with restraint, the way the brand is felt before the copy is even read.
- Average design fills a page. Premium design guides attention. Average design looks finished. Premium design feels intentional.
- It is not about adding more. It is about making every detail feel like it belongs.
The output must be a website people remember, not one they scroll past.

# PHASE 1 — GROUND IT IN THE SUBJECT (before any pixels)
1. Pin the subject: one concrete business, its audience, and the page's single job (e.g. "make a managing partner trust this law firm enough to book a call"). Commit to it.
2. Mine the subject's own world for design material: its materials, instruments, artifacts, vernacular. A law firm has paper, seals, serif tradition, verticality of columns. A dental clinic has porcelain, precision, light. Distinctive choices come from the subject, never from a generic "modern SaaS" moodboard.
3. Define the FEELING in 3 adjectives (e.g. "assured, quiet, expensive"). Every later decision is tested against these three words.

# PHASE 2 — DESIGN TOKENS (decide before coding)
- COLOR: 4–6 named hex values. One dominant neutral, one deep anchor, ONE accent used with extreme restraint (<5% of surface area). Palette must be derivable from the subject, not from fashion.
- TYPE: minimum two roles — a characterful display face (used sparingly, large) and a complementary body face; optionally a utility/mono face for captions, data, labels. Never default to Inter-for-everything. Fluid type scale with clamp() (e.g. --step-5: clamp(3rem, 8vw, 7rem)). Tight letter-spacing on display sizes (-0.02em to -0.04em), generous line-height on body (1.6–1.7).
- SPACE: an 8px-based spacing scale with LARGE section rhythm — premium pages breathe: section padding 120–200px desktop, 64–96px mobile. Whitespace is a feature, not leftover space.
- SIGNATURE: name the ONE element this page will be remembered by (a hero interaction, a typographic device, a scroll moment). Spend all boldness there; keep everything else quiet.
- AUTHORITY: if a Brand Kit (brand colors/fonts/tone) is present in this prompt, tokens MUST derive from it; otherwise derive them from the subject. If an approved page plan (blueprint) is present, the plan wins on STRUCTURE (sections/CTA); this philosophy governs EXECUTION.
- RECORD THE TOKENS IN THE FILE: embed exactly ONE HTML comment inside <head>, in this exact shape:
  <!-- ${DESIGN_TOKENS_MARK} {"feeling":["adj1","adj2","adj3"],"colors":[{"name":"Ink","hex":"#101014"}],"type":{"display":"Fraunces","body":"Inter","mono":"IBM Plex Mono"},"space":"8px scale, sections 160/80","signature":{"element":"...","why":"... (2 sentences)"}} -->
  Strict valid JSON (double quotes, no trailing commas) and it must NOT contain the character sequence "-->".

# ANTI-TEMPLATE GUARD
Before building, ask: "would I produce this same plan for any other client in this industry?" If yes, revise. Explicitly avoid the three current AI-default looks unless the brief demands one: (1) cream #F4F1EA + serif + terracotta, (2) near-black + a single acid-green/vermilion accent, (3) broadsheet hairline-rules newspaper layout.

# PHASE 3 — LAYOUT & PACING
- The hero is a thesis. Open with the most characteristic thing in the subject's world — a statement headline, an image treatment, a live moment. Not "big number + small label + gradient blob".
- Design the SCROLL as a narrative with rhythm: tension → release. Alternate dense and airy sections. A full-bleed image after a text-heavy block. A single centered line after a grid. Pacing is felt, not seen.
- Asymmetry over symmetry where the grid allows: offset columns, overlapping elements, images breaking the container. A 12-column grid used with discipline, then broken once, deliberately.
- Structure is information: eyebrows, numbering, dividers only when they encode something true (a real process, a real sequence). Never decorative "01/02/03" by default.
- Sections and their count come from the approved plan when present (each earns its place with a business justification) — no filler sections.
- Every section must answer: what should the visitor FEEL here, and what is the ONE thing they should look at first?

# PHASE 4 — MOTION (restraint is the skill)
- One orchestrated moment beats ten scattered effects. Usually: a page-load sequence in the hero (staggered reveal, 600–900ms total), then quiet scroll-triggered reveals for the rest.
- Easing: custom cubic-bezier, e.g. cubic-bezier(0.16, 1, 0.3, 1) ("expo out") — never default ease. Durations 400–800ms for reveals, 150–250ms for hover micro-interactions.
- Scroll reveals: translateY 20–40px + opacity, staggered 60–100ms between siblings, triggered once at ~85% viewport (IntersectionObserver, never scroll listeners). Subtle. If the user notices the animation more than the content, remove it.
- Micro-interactions on every interactive element: links with animated underlines, buttons with a real hover state (not just a color swap), images with a slow scale-on-hover (1.03–1.05, 700ms).
- NO external animation libraries (no GSAP, no Lenis, no Three.js) — pure CSS/JS equivalents only. If the brief justifies a 3D hero moment, follow the separate 3D policy instruction included in the request.
- No preloader by default (never block first paint/LCP) — only when the approved plan explicitly demands one.
- ALWAYS respect prefers-reduced-motion with a full non-animated fallback.

# PHASE 5 — COPY IS DESIGN MATERIAL
- Write copy with the same intentionality as spacing. Short declarative lines in heroes. Specific beats clever ("Umów bezpłatną konsultację 20 min" beats "Zacznijmy współpracę").
- Active voice, sentence case, plain verbs. A button says exactly what happens. No filler, no corporate padding.
- The brand voice must match the 3 feeling-adjectives from Phase 1.

# PHASE 6 — QUALITY FLOOR
The technical specification in this prompt (file rules and, for new pages, the completeness spec) is the non-negotiable floor. Apply it fully and silently — never announce it in the output.

# PHASE 7 — SELF-CRITIQUE BEFORE DELIVERY (run silently, fix failures, then output ONLY the final code)
1. Squint test — is there ONE clear focal point per viewport?
2. Template test — could this be mistaken for a generic AI page?
3. Chanel test — remove one decorative element. Did the design get better?
4. Feeling test — does it hit the 3 adjectives without reading the copy?
5. Pacing test — scroll top to bottom: is there rhythm, or monotone blocks?
6. Motion test — is every animation invisible-until-helpful?
7. Would a client paying 30 000+ PLN feel this is worth it?`;

/** Checklista Fazy 7 do pętli „Ulepsz" (improveSite) — te same kryteria, jawnie w instrukcji. */
export const SELF_CRITIQUE_INSTRUCTION =
  "Przejdź jawnie przez checklistę PHASE 7 (squint / template / Chanel / feeling / pacing / motion / „czy warte 30 000+ zł”) i napraw każde niedociągnięcie.";

/**
 * Pure: złóż finalny system prompt generatora stron. Kolejność: twarde zasady pliku →
 * metodologia premium (z anti-template guard i kontraktem tokenów) → pełna specyfikacja
 * kompletności (TYLKO nowa strona) → typ witryny → kierunek stylu.
 */
export function designSystemPrompt(opts: {
  kindHint: string;
  styleHint: string;
  isEdit: boolean;
  fullSpec?: string;
}): string {
  const parts = [HARD_RULES, PHILOSOPHY];
  if (!opts.isEdit && opts.fullSpec) parts.push(opts.fullSpec);
  if (opts.kindHint) parts.push(opts.kindHint);
  if (opts.styleHint) parts.push(opts.styleHint);
  return parts.join("\n\n");
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function cap(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Pure: wyciągnij i zwaliduj design tokens z komentarza DESIGN-TOKENS w HTML-u.
 * Nigdy nie rzuca: brak komentarza / zepsuty JSON / zły kształt → null. Pola są przycinane
 * do bezpiecznych długości, a kolory przechodzą TYLKO jako poprawny #rgb/#rrggbb
 * (bezpieczne do wstawienia w inline style swatcha — żaden „javascript:" nie przejdzie).
 */
export function parseDesignTokens(html: string): DesignTokens | null {
  const m = /<!--\s*DESIGN-TOKENS\b([\s\S]*?)-->/.exec(html || "");
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(m[1].trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const feeling = Array.isArray(r.feeling)
    ? r.feeling.map((s) => cap(s, 40)).filter(Boolean).slice(0, 5)
    : [];

  const colors: DesignTokenColor[] = [];
  if (Array.isArray(r.colors)) {
    for (const c of r.colors) {
      if (!c || typeof c !== "object") continue;
      const hex = cap((c as Record<string, unknown>).hex, 8);
      if (!HEX_RE.test(hex)) continue; // twarda walidacja — odpada wszystko poza #rgb/#rrggbb
      colors.push({ name: cap((c as Record<string, unknown>).name, 40) || hex, hex });
      if (colors.length >= 8) break;
    }
  }

  const ty = r.type && typeof r.type === "object" && !Array.isArray(r.type) ? (r.type as Record<string, unknown>) : {};
  const sig = r.signature && typeof r.signature === "object" && !Array.isArray(r.signature) ? (r.signature as Record<string, unknown>) : {};
  const signature = { element: cap(sig.element, 160), why: cap(sig.why, 400) };

  // Minimalny sensowny kształt: kolory LUB element-podpis — inaczej to śmieć, nie tokeny.
  if (!colors.length && !signature.element) return null;

  return {
    feeling,
    colors,
    type: {
      display: cap(ty.display, 60) || undefined,
      body: cap(ty.body, 60) || undefined,
      mono: cap(ty.mono, 60) || undefined,
    },
    space: cap(r.space, 120) || undefined,
    signature,
  };
}

/** Pure: krótki, ludzki opis tokenów (UI/czat) — bez zmyślania brakujących pól. */
export function designTokensSummary(t: DesignTokens): string {
  const parts: string[] = [];
  if (t.feeling.length) parts.push(`Charakter: ${t.feeling.join(" · ")}`);
  if (t.colors.length) parts.push(`Paleta: ${t.colors.map((c) => `${c.name} ${c.hex}`).join(", ")}`);
  const ty = [
    t.type.display ? `nagłówki ${t.type.display}` : "",
    t.type.body ? `tekst ${t.type.body}` : "",
    t.type.mono ? `mono ${t.type.mono}` : "",
  ].filter(Boolean).join(", ");
  if (ty) parts.push(`Typografia: ${ty}`);
  if (t.signature.element) parts.push(`Element-podpis: ${t.signature.element}${t.signature.why ? ` — ${t.signature.why}` : ""}`);
  return parts.join("\n");
}
