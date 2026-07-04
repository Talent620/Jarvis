import { describe, it, expect } from "vitest";
import {
  GUIDE_ORDER, guideQuestion, suggestKind, suggestStyle, suggestSections,
  guideAdvice, guideSuggestions, applyAnswer, nextStepId, guideProgress, guideToBrief, isSkippable,
} from "../src/lib/webGuide";
import type { GuideAnswers } from "../src/lib/webGuide";

// Przewodnik budowy strony: deterministyczny tor rozmowy. Testy pilnują heurystyk podpowiedzi,
// akumulacji odpowiedzi i złożenia briefu — bez AI (tor musi być pewny).

describe("heurystyki podpowiedzi", () => {
  it("suggestKind wnioskuje typ z celu/branży", () => {
    expect(suggestKind({ goal: "chcę sprzedawać online" })).toBe("sklep");
    expect(suggestKind({ goal: "pokazać realizacje" })).toBe("portfolio");
    expect(suggestKind({ goal: "pozyskać klientów" })).toBe("landing");
    expect(suggestKind({ industry: "aplikacja SaaS" })).toBe("saas");
    expect(suggestKind({})).toBe("firma"); // domyślnie
  });
  it("suggestStyle dobiera styl do branży (premium/tech/gastro)", () => {
    expect(suggestStyle({ industry: "stolarnia na wymiar" })).toBe("luxury");
    expect(suggestStyle({ industry: "kancelaria prawna" })).toBe("luxury");
    expect(suggestStyle({ industry: "aplikacja software" })).toBe("linear");
    expect(suggestStyle({ industry: "kawiarnia specialty" })).toBe("organic");
    expect(suggestStyle({ industry: "coś nietypowego" })).toBe("auto");
  });
  it("suggestSections zależą od typu strony", () => {
    expect(suggestSections({ kind: "sklep" })).toMatch(/produkt/i);
    expect(suggestSections({ kind: "portfolio" })).toMatch(/galeri/i);
    expect(suggestSections({ kind: "landing" })).toMatch(/CTA/);
    expect(suggestSections({})).toMatch(/o firmie/i); // fallback firma
  });
});

describe("tor rozmowy — kolejność, postęp, pomijanie", () => {
  it("GUIDE_ORDER kończy się na „done”; nextStepId idzie do przodu i zatrzymuje na done", () => {
    expect(GUIDE_ORDER[GUIDE_ORDER.length - 1]).toBe("done");
    expect(nextStepId("business")).toBe("industry");
    expect(nextStepId("contact")).toBe("done");
    expect(nextStepId("done")).toBe("done");
  });
  it("guideProgress: „done” nie jest liczone jako pytanie", () => {
    const p = guideProgress("business");
    expect(p.index).toBe(0);
    expect(p.total).toBe(GUIDE_ORDER.length - 1);
    expect(guideProgress("done").index).toBe(p.total);
  });
  it("każdy krok ma niepuste pytanie i radę", () => {
    for (const id of GUIDE_ORDER) {
      expect(guideQuestion(id).length).toBeGreaterThan(0);
      expect(guideAdvice(id, {}).length).toBeGreaterThan(0);
    }
  });
  it("audience i contact są opcjonalne (skippable)", () => {
    expect(isSkippable("audience")).toBe(true);
    expect(isSkippable("contact")).toBe(true);
    expect(isSkippable("business")).toBe(false);
  });
});

describe("podpowiedzi-chipy", () => {
  it("krok „kind” stawia rekomendację na początku z ptaszkiem", () => {
    const chips = guideSuggestions("kind", { goal: "sprzedawać online" });
    expect(chips[0].value).toBe("sklep");
    expect(chips[0].label).toContain("✅");
  });
  it("krok „style” zawiera sugestię z branży jako pierwszą", () => {
    const chips = guideSuggestions("style", { industry: "stolarnia" });
    expect(chips[0].value).toBe("luxury");
  });
  it("krok „goal” ma 4 gotowe cele", () => {
    expect(guideSuggestions("goal", {}).length).toBe(4);
  });
});

describe("akumulacja i złożenie briefu", () => {
  it("applyAnswer zapisuje odpowiedź; puste kind/style/sections biorą sugestię", () => {
    let a: GuideAnswers = {};
    a = applyAnswer(a, "business", "Stolarnia Dąb");
    a = applyAnswer(a, "industry", "stolarnia schodów");
    a = applyAnswer(a, "goal", "pozyskać klientów");
    expect(a.business).toBe("Stolarnia Dąb");
    // pusty wybór typu → sugestia z celu (landing)
    a = applyAnswer(a, "kind", "");
    expect(a.kind).toBe("landing");
    // pusty styl → sugestia z branży (luxury)
    a = applyAnswer(a, "style", "");
    expect(a.style).toBe("luxury");
    a = applyAnswer(a, "sections", "");
    expect(a.sections && a.sections.length).toBeGreaterThan(0);
  });
  it("applyAnswer nie mutuje wejścia", () => {
    const a: GuideAnswers = { business: "X" };
    const b = applyAnswer(a, "industry", "Y");
    expect(a.industry).toBeUndefined();
    expect(b.industry).toBe("Y");
  });
  it("guideToBrief składa brief tylko z wypełnionych pól", () => {
    const brief = guideToBrief({ business: "Firma", industry: "stolarz", goal: "pozyskać", audience: "  ", kind: "landing" });
    expect(brief.business).toBe("Firma");
    expect(brief.industry).toBe("stolarz");
    expect(brief.audience).toBeUndefined(); // same spacje → pomijamy
    expect(brief.sections).toBeTruthy();    // dołożone z sugestii dla landing
  });
});
