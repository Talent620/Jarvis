// === Przewodnik budowy strony w rozmowie (webGuide) — „zbuduj z JARVISEM krok po kroku" ===
// PO CO: pusty formularz briefu onieśmiela („co tu wpisać?"). Ten silnik prowadzi ROZMOWĄ: zadaje
// JEDNO pytanie na raz, DORADZA (co i dlaczego), podpowiada gotowe odpowiedzi dopasowane do branży
// i celu, i składa z tego gotowy brief + typ + styl — który trafia prosto do istniejącego
// planowania (planBlueprint) i budowy (generateSite). Przepływ jest DETERMINISTYCZNY (pewny,
// testowalny); AI dokłada tylko opcjonalną poradę i nie może zepsuć toru. S9-safe.

import type { SiteKind, SiteStyle, ClientBrief } from "./webgen";

export type GuideStepId = "business" | "industry" | "goal" | "audience" | "kind" | "style" | "sections" | "contact" | "done";

export interface GuideAnswers {
  business?: string;
  industry?: string;
  goal?: string;
  audience?: string;
  kind?: SiteKind;
  style?: SiteStyle;
  sections?: string;
  contact?: string;
}

/** Kolejność kroków rozmowy (ostatni „done” = podsumowanie + budowa). */
export const GUIDE_ORDER: GuideStepId[] = ["business", "industry", "goal", "audience", "kind", "style", "sections", "contact", "done"];

export interface GuideChip { value: string; label: string }

/** Pure: pytanie bieżącego kroku (po ludzku, jedno na raz). */
export function guideQuestion(id: GuideStepId): string {
  switch (id) {
    case "business": return "Zacznijmy od podstaw — jak nazywa się firma albo czyja to strona?";
    case "industry": return "Czym się zajmuje? (np. stolarnia, kancelaria, kawiarnia, sklep z odzieżą)";
    case "goal": return "Co ta strona ma przede wszystkim osiągnąć?";
    case "audience": return "Do kogo mówimy? Kto ma trafić na tę stronę?";
    case "kind": return "Jaki typ strony najlepiej pasuje? (podpowiadam na podstawie celu)";
    case "style": return "Dobierzmy charakter wizualny. Który styl pasuje do tej marki?";
    case "sections": return "Jakie sekcje ma mieć strona? (proponuję zestaw — możesz zmienić)";
    case "contact": return "Na koniec kontakt — jaki telefon i/lub e-mail pokazać na stronie?";
    case "done": return "Mam komplet. Zbudować stronę na podstawie tych ustaleń?";
  }
}

// — Heurystyki podpowiedzi (czyste, oparte na tym, co użytkownik już powiedział) —

const has = (s: string | undefined, ...keys: string[]): boolean => {
  const t = (s || "").toLowerCase();
  return keys.some((k) => t.includes(k));
};

/** Pure: sugerowany typ strony z celu/branży. */
export function suggestKind(a: GuideAnswers): SiteKind {
  if (has(a.goal, "sprzeda", "sklep", "kupi", "koszyk") || has(a.industry, "sklep")) return "sklep";
  if (has(a.goal, "realizacj", "portfolio", "galeri", "prace", "zdjęci", "pokaza")) return "portfolio";
  if (has(a.goal, "lead", "pozyska", "zapis", "kontakt", "umów", "rezerwacj")) return "landing";
  if (has(a.industry, "saas", "aplikacj", "software", "startup")) return "saas";
  return "firma";
}

/** Pure: sugerowany styl z branży (premium rzemiosło → luxury, tech → linear, gastro → organic…). */
export function suggestStyle(a: GuideAnswers): SiteStyle {
  if (has(a.industry, "stolar", "jubiler", "kancelari", "prawnik", "architekt", "wnętrz", "luksus", "premium", "spa")) return "luxury";
  if (has(a.industry, "saas", "aplikacj", "software", "tech", "startup", "it ")) return "linear";
  if (has(a.industry, "fintech", "płatnoś", "finans", "księgow")) return "stripe";
  if (has(a.industry, "kawiarni", "restauracj", "gastro", "piekarni", "eko", "kwiaci", "uroda", "kosmet")) return "organic";
  if (has(a.industry, "foto", "artyst", "design", "moda", "streetwear")) return "editorial";
  return "auto";
}

/** Pure: proponowany zestaw sekcji z typu strony (edytowalny przez użytkownika). */
export function suggestSections(a: GuideAnswers): string {
  const kind = a.kind || suggestKind(a);
  switch (kind) {
    case "sklep": return "hero, kategorie, bestsellery, produkty, opinie klientów, dostawa i zwroty, kontakt";
    case "portfolio": return "hero, galeria realizacji, o mnie, proces współpracy, opinie, kontakt";
    case "landing": return "hero z mocnym CTA, korzyści, jak to działa, opinie/logo zaufania, cennik, FAQ, kontakt";
    case "saas": return "hero z CTA, funkcje, integracje, cennik, opinie, FAQ, kontakt";
    case "blog": return "hero, najnowsze wpisy, kategorie, o autorze, newsletter, kontakt";
    default: return "hero, o firmie, usługi, realizacje/portfolio, opinie, dane kontaktowe";
  }
}

/** Pure: krótka RADA dla bieżącego kroku — dlaczego to ważne + rekomendacja z dotychczasowych odpowiedzi. */
export function guideAdvice(id: GuideStepId, a: GuideAnswers): string {
  switch (id) {
    case "business": return "Nazwa firmy trafi w nagłówek i tytuł strony (SEO). Podaj tak, jak ma być widoczna.";
    case "industry": return "Branża steruje całą resztą — dobiorę do niej styl, sekcje i język. Im konkretniej, tym lepiej.";
    case "goal": return "Cel decyduje o układzie: „pozyskać klientów” → landing z jednym CTA; „pokazać realizacje” → portfolio z galerią; „sprzedawać” → sklep z koszykiem.";
    case "audience": return "Grupa docelowa nadaje ton i słownictwo (inaczej piszemy do pary młodej, inaczej do zarządu). Wpłynie na nagłówki i CTA.";
    case "kind": return `Na podstawie celu proponuję: ${labelKind(suggestKind(a))}. Możesz wybrać inny — to zmienia strukturę strony.`;
    case "style": {
      const s = suggestStyle(a);
      return s === "auto"
        ? "Dla tej branży dobiorę styl automatycznie pod temat (silnik projektowy unika „szablonu AI”)."
        : `Dla branży „${a.industry || "tej"}” pasuje styl ${labelStyle(s)} — spójny z charakterem marki.`;
    }
    case "sections": return "To szkielet strony. Zostaw proponowane albo dopisz/usuń — każda sekcja powinna mieć powód (nie „na zapełnienie”).";
    case "contact": return "Kontakt to najważniejsza konwersja. Telefon klikalny + e-mail; jeśli masz, dodam też formularz i mapę.";
    case "done": return "Zbuduję kompletną stronę (SEO, RODO, responsywność) wg tych ustaleń. Potem dopracujesz ją słowem albo przyciskiem „Ulepsz”.";
  }
}

/** Pure: gotowe podpowiedzi-chipy dla kroku (klik = wybór; puste = tylko wolny tekst). */
export function guideSuggestions(id: GuideStepId, a: GuideAnswers): GuideChip[] {
  switch (id) {
    case "goal": return [
      { value: "pozyskać klientów / zapytania", label: "📞 Pozyskać klientów" },
      { value: "pokazać realizacje / portfolio", label: "🖼 Pokazać realizacje" },
      { value: "sprzedawać online", label: "🛒 Sprzedawać online" },
      { value: "zbudować prestiż / wizytówka", label: "✨ Prestiż / wizytówka" },
    ];
    case "kind": {
      const s = suggestKind(a);
      const all: SiteKind[] = ["firma", "landing", "sklep", "portfolio", "saas", "blog"];
      return [s, ...all.filter((k) => k !== s)].map((k) => ({ value: k, label: (k === s ? "✅ " : "") + labelKind(k) }));
    }
    case "style": {
      const s = suggestStyle(a);
      const picks = ([s, "luxury", "editorial", "organic", "linear", "minimal", "auto"] as SiteStyle[]).filter((v, i, arr) => arr.indexOf(v) === i);
      return picks.map((v) => ({ value: v, label: (v === s ? "✅ " : "") + labelStyle(v) }));
    }
    case "sections": return [{ value: suggestSections(a), label: "✅ Użyj proponowanych" }];
    default: return [];
  }
}

/** Pure: zastosuj odpowiedź do stanu — zwraca nowy zestaw odpowiedzi (nie mutuje). */
export function applyAnswer(a: GuideAnswers, id: GuideStepId, value: string): GuideAnswers {
  const v = (value || "").trim();
  const next: GuideAnswers = { ...a };
  switch (id) {
    case "business": next.business = v; break;
    case "industry": next.industry = v; break;
    case "goal": next.goal = v; break;
    case "audience": next.audience = v; break;
    case "kind": next.kind = (v || suggestKind(a)) as SiteKind; break;
    case "style": next.style = (v || suggestStyle(a)) as SiteStyle; break;
    case "sections": next.sections = v || suggestSections(a); break;
    case "contact": next.contact = v; break;
    case "done": break;
  }
  return next;
}

/** Pure: następny krok po bieżącym (albo „done”, gdy koniec). */
export function nextStepId(current: GuideStepId): GuideStepId {
  const i = GUIDE_ORDER.indexOf(current);
  return i < 0 || i >= GUIDE_ORDER.length - 1 ? "done" : GUIDE_ORDER[i + 1];
}

/** Pure: postęp rozmowy (do paska): indeks 0-based i liczba pytań (bez „done”). */
export function guideProgress(id: GuideStepId): { index: number; total: number } {
  const total = GUIDE_ORDER.length - 1; // „done” to nie pytanie
  const index = Math.min(GUIDE_ORDER.indexOf(id), total);
  return { index, total };
}

/** Pure: czy krok wolno pominąć (grupa docelowa / kontakt bywają opcjonalne). */
export function isSkippable(id: GuideStepId): boolean {
  return id === "audience" || id === "contact";
}

/** Pure: złóż gotowy ClientBrief z odpowiedzi (do planBlueprint/generateSite). */
export function guideToBrief(a: GuideAnswers): ClientBrief {
  return {
    business: a.business?.trim() || undefined,
    industry: a.industry?.trim() || undefined,
    goal: a.goal?.trim() || undefined,
    audience: a.audience?.trim() || undefined,
    sections: (a.sections?.trim() || suggestSections(a)) || undefined,
    contact: a.contact?.trim() || undefined,
  };
}

// — Etykiety (po polsku) —
export function labelKind(k: SiteKind): string {
  const m: Record<SiteKind, string> = { auto: "Auto", firma: "Strona firmowa", landing: "Landing (jedna akcja)", sklep: "Sklep", portfolio: "Portfolio", saas: "SaaS / aplikacja", blog: "Blog" };
  return m[k] || k;
}
export function labelStyle(s: SiteStyle): string {
  const m: Partial<Record<SiteStyle, string>> = {
    auto: "Auto (dobiorę)", luxury: "Luxury", editorial: "Edytorial", organic: "Organiczny", linear: "Linear", stripe: "Stripe",
    minimal: "Minimal", swiss: "Swiss", glass: "Glass", neon: "Neon", brutalist: "Brutalizm", retro: "Retro Y2K",
  };
  return m[s] || s;
}
