// === Inteligentny plan strony PRZED generowaniem (siteBlueprint) ===
// Kreator najpierw MYŚLI, potem projektuje. Zamiast od razu sypać 8–12 sekcjami, budujemy
// walidowany plan: cel biznesowy, odbiorca, główna akcja (CTA), oferta, obiekcje, dowody, typ
// strony, sekcje (KAŻDA z uzasadnieniem biznesowym), hierarchia treści, kierunek wizualny, tokeny,
// poziom animacji, tryb 3D, intencja SEO, plan pomiarów, tryb formularza i budżet wydajności.
// Gemini może zwrócić structured output, ale ZAWSZE walidujemy semantycznie, a offline mamy
// deterministyczny fallback. Preloader domyślnie WYŁĄCZONY. Czyste i testowalne. S9-safe.

import type { ClientBrief } from "./webgen";

export type MotionLevel = "none" | "subtle" | "rich";
export type ThreeDMode = "off" | "css" | "real" | "auto";
export type FormMode = "none" | "demo" | "connected";

export interface BlueprintSection {
  id: string;
  kind: string;          // hero | offer | proof | objections | faq | cta | about | contact | gallery
  purpose: string;       // co ta sekcja robi
  justification: string; // DLACZEGO jest (biznesowo) — sekcja bez uzasadnienia jest odrzucana
}

export interface PerformanceBudget { lcpMs: number; inpMs: number; cls: number }

export interface SiteBlueprint {
  businessGoal: string;
  audience: string;
  primaryAction: string;   // CTA
  offer: string;
  objections: string[];
  proof: string[];
  pageType: string;        // landing | sklep | portfolio | wizytowka
  sections: BlueprintSection[];
  contentHierarchy: string[]; // uporządkowane id sekcji (hero → … → cta)
  visualDirection: string;
  designTokens: { primary?: string; accent?: string; font?: string };
  motionLevel: MotionLevel;
  threeDMode: ThreeDMode;
  seoIntent: string;
  trackingPlan: string[];
  formMode: FormMode;
  performanceBudget: PerformanceBudget;
  preloader: boolean;      // domyślnie false
}

// Cele Core Web Vitals (web.dev) — twardy sufit budżetu.
const TARGET: PerformanceBudget = { lcpMs: 2500, inpMs: 200, cls: 0.1 };

// JSON Schema do structured output (Gemini). Walidacja semantyczna i tak następuje niżej.
export const SITE_BLUEPRINT_SCHEMA = {
  type: "object",
  properties: {
    businessGoal: { type: "string" },
    audience: { type: "string" },
    primaryAction: { type: "string" },
    offer: { type: "string" },
    objections: { type: "array", items: { type: "string" } },
    proof: { type: "array", items: { type: "string" } },
    pageType: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, kind: { type: "string" }, purpose: { type: "string" }, justification: { type: "string" } },
        required: ["kind", "justification"],
      },
    },
    visualDirection: { type: "string" },
    seoIntent: { type: "string" },
  },
  required: ["businessGoal", "primaryAction"],
} as const;

const str = (x: unknown, fb = ""): string => (typeof x === "string" && x.trim() ? x.trim() : fb);
const arr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : []);
const clampBudget = (b?: Partial<PerformanceBudget>): PerformanceBudget => ({
  lcpMs: Math.min(TARGET.lcpMs, Math.max(500, b?.lcpMs ?? TARGET.lcpMs)),
  inpMs: Math.min(TARGET.inpMs, Math.max(50, b?.inpMs ?? TARGET.inpMs)),
  cls: Math.min(TARGET.cls, Math.max(0, b?.cls ?? TARGET.cls)),
});

// Logiczna kolejność rodzajów sekcji (hero na górze, CTA/kontakt na dole).
const ORDER = ["hero", "about", "offer", "proof", "gallery", "objections", "faq", "contact", "cta"];
const orderKey = (kind: string): number => {
  const i = ORDER.indexOf(kind);
  return i < 0 ? ORDER.length - 1 : i; // nieznane tuż przed CTA
};

/** Pure: deterministyczny plan offline z briefu — minimalny, sensowny zestaw sekcji Z UZASADNIENIEM. */
export function fallbackBlueprint(brief: ClientBrief = {}): SiteBlueprint {
  const business = str(brief.business, "Twoja firma");
  const goal = str(brief.goal, "Pozyskać klientów i zapytania ofertowe");
  const sections: BlueprintSection[] = [
    { id: "hero", kind: "hero", purpose: "Chwyta uwagę i mówi, co firma oferuje", justification: "Bez jasnego nagłówka i CTA odwiedzający wychodzą w kilka sekund." },
    { id: "offer", kind: "offer", purpose: "Konkretna oferta/usługi", justification: "Pokazuje wartość — powód, by zostać i zapytać." },
    { id: "proof", kind: "proof", purpose: "Dowody: opinie, realizacje, liczby", justification: "Buduje zaufanie i podnosi konwersję." },
    { id: "cta", kind: "cta", purpose: "Wezwanie do działania i kontakt", justification: "Domyka ścieżkę — bez CTA nie ma zapytań." },
  ];
  return {
    businessGoal: goal,
    audience: str(brief.audience, "Lokalni klienci szukający tej usługi"),
    primaryAction: "Zostaw zapytanie / zadzwoń",
    offer: str(brief.extra, str(brief.industry, "Usługi firmy")),
    objections: ["Czy to nie za drogie?", "Czy zdążycie na czas?"],
    proof: [],
    pageType: str(brief.industry, "").toLowerCase().includes("sklep") ? "sklep" : "landing",
    sections,
    contentHierarchy: sections.map((s) => s.id),
    visualDirection: str(brief.colors, "Nowoczesny, czysty, z wyraźnym CTA"),
    designTokens: {},
    motionLevel: "subtle",
    threeDMode: "auto",
    seoIntent: `${business} — ${str(brief.industry, "usługi")}`,
    trackingPlan: ["klik CTA", "wysłanie formularza"],
    formMode: "demo",
    performanceBudget: { ...TARGET },
    preloader: false,
  };
}

/**
 * Pure: zwaliduj/napraw plan (z Gemini lub skądkolwiek). Zawsze zwraca poprawny SiteBlueprint:
 * cel i CTA są wymagane (uzupełniane z fallbacku), sekcje BEZ uzasadnienia są odrzucane, a gdy
 * nie zostanie żadna — bierzemy sekcje fallbacku. Hierarchia treści jest logiczna (hero→…→cta).
 */
export function validateBlueprint(raw: unknown, brief: ClientBrief = {}): SiteBlueprint {
  const fb = fallbackBlueprint(brief);
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch { obj = null; } }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return fb; // nie da się odczytać → deterministyczny fallback

  // Sekcje: tylko te z uzasadnieniem biznesowym; nadaj brakujące id; posortuj logicznie.
  const rawSections = Array.isArray(obj.sections) ? (obj.sections as Record<string, unknown>[]) : [];
  let sections: BlueprintSection[] = rawSections
    .filter((s) => str(s?.justification))
    .map((s, i) => ({
      id: str(s?.id, `s${i + 1}`),
      kind: str(s?.kind, "section"),
      purpose: str(s?.purpose, "—"),
      justification: str(s?.justification),
    }));
  if (!sections.length) sections = fb.sections;
  sections = [...sections].sort((a, b) => orderKey(a.kind) - orderKey(b.kind));

  return {
    businessGoal: str(obj.businessGoal, fb.businessGoal),
    audience: str(obj.audience, fb.audience),
    primaryAction: str(obj.primaryAction, fb.primaryAction),
    offer: str(obj.offer, fb.offer),
    objections: arr(obj.objections).length ? arr(obj.objections) : fb.objections,
    proof: arr(obj.proof),
    pageType: str(obj.pageType, fb.pageType),
    sections,
    contentHierarchy: sections.map((s) => s.id),
    visualDirection: str(obj.visualDirection, fb.visualDirection),
    designTokens: (obj.designTokens && typeof obj.designTokens === "object" ? obj.designTokens : fb.designTokens) as SiteBlueprint["designTokens"],
    motionLevel: (["none", "subtle", "rich"].includes(obj.motionLevel as string) ? obj.motionLevel : fb.motionLevel) as MotionLevel,
    threeDMode: (["off", "css", "real", "auto"].includes(obj.threeDMode as string) ? obj.threeDMode : fb.threeDMode) as ThreeDMode,
    seoIntent: str(obj.seoIntent, fb.seoIntent),
    trackingPlan: arr(obj.trackingPlan).length ? arr(obj.trackingPlan) : fb.trackingPlan,
    formMode: (["none", "demo", "connected"].includes(obj.formMode as string) ? obj.formMode : fb.formMode) as FormMode,
    performanceBudget: clampBudget(obj.performanceBudget as Partial<PerformanceBudget>),
    preloader: obj.preloader === true, // domyślnie WYŁĄCZONY
  };
}

/** Pure: krótki, ludzki opis planu do zatwierdzenia PRZED generowaniem. */
export function blueprintSummary(bp: SiteBlueprint): string {
  const secs = bp.sections.map((s) => `• ${s.kind}: ${s.purpose} — ${s.justification}`).join("\n");
  return `Cel: ${bp.businessGoal}\nCTA: ${bp.primaryAction}\nTyp: ${bp.pageType}\nSekcje:\n${secs}`;
}
