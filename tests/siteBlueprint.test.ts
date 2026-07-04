// === Inteligentny plan strony (siteBlueprint) — testy ===
// Kreator najpierw myśli. Sprawdzamy: naprawę niepełnego/błędnego JSON-a Gemini, deterministyczny
// fallback offline, sekcje TYLKO z uzasadnieniem, logiczną kolejność (hero→…→cta), budżet wydajności
// i wyłączony preloader.
import { describe, it, expect } from "vitest";
import { validateBlueprint, fallbackBlueprint, blueprintSummary } from "../src/lib/siteBlueprint";

describe("siteBlueprint — fallback offline", () => {
  it("zawsze ma cel, CTA i logiczne sekcje", () => {
    const bp = fallbackBlueprint({ business: "Alfa", industry: "gastronomia", goal: "więcej rezerwacji" });
    expect(bp.businessGoal).toMatch(/rezerwacji/i);
    expect(bp.primaryAction).toBeTruthy();
    expect(bp.sections.length).toBeGreaterThan(0);
    expect(bp.sections[0].kind).toBe("hero");
    expect(bp.sections[bp.sections.length - 1].kind).toBe("cta");
    expect(bp.preloader).toBe(false); // preloader domyślnie wyłączony
  });
});

describe("siteBlueprint — walidacja/naprawa wejścia AI", () => {
  it("błędny JSON (śmieci) → deterministyczny fallback z celem i CTA", () => {
    const bp = validateBlueprint("to nie jest json", { business: "Beta" });
    expect(bp.businessGoal).toBeTruthy();
    expect(bp.primaryAction).toBeTruthy();
    expect(bp.sections.length).toBeGreaterThan(0);
  });

  it("niepełny JSON (brak sekcji) → uzupełnione sensownymi sekcjami; cel/CTA zachowane", () => {
    const bp = validateBlueprint(JSON.stringify({ businessGoal: "sprzedaż kursu", primaryAction: "Kup teraz" }), {});
    expect(bp.businessGoal).toBe("sprzedaż kursu");
    expect(bp.primaryAction).toBe("Kup teraz");
    expect(bp.sections.length).toBeGreaterThan(0);
  });

  it("sekcje BEZ uzasadnienia są odrzucane; nie generujemy sekcji bez powodu", () => {
    const bp = validateBlueprint({
      businessGoal: "x", primaryAction: "y",
      sections: [
        { kind: "hero", purpose: "p", justification: "buduje uwagę" },
        { kind: "gallery", purpose: "zdjęcia" }, // brak justification → odrzucona
        { kind: "cta", purpose: "kontakt", justification: "domyka" },
      ],
    });
    expect(bp.sections.map((s) => s.kind)).not.toContain("gallery");
    expect(bp.sections.every((s) => s.justification.length > 0)).toBe(true);
  });

  it("hierarchia treści jest logiczna (hero na górze, cta na dole) niezależnie od kolejności wejścia", () => {
    const bp = validateBlueprint({
      businessGoal: "x", primaryAction: "y",
      sections: [
        { kind: "cta", justification: "domyka" },
        { kind: "hero", justification: "uwaga" },
        { kind: "proof", justification: "zaufanie" },
      ],
    });
    expect(bp.sections[0].kind).toBe("hero");
    expect(bp.sections[bp.sections.length - 1].kind).toBe("cta");
    expect(bp.contentHierarchy).toEqual(bp.sections.map((s) => s.id));
  });

  it("budżet wydajności przycięty do celów Core Web Vitals; preloader tylko na wyraźne żądanie", () => {
    const bp = validateBlueprint({ businessGoal: "x", primaryAction: "y", performanceBudget: { lcpMs: 9000, inpMs: 999, cls: 1 }, preloader: false });
    expect(bp.performanceBudget.lcpMs).toBeLessThanOrEqual(2500);
    expect(bp.performanceBudget.inpMs).toBeLessThanOrEqual(200);
    expect(bp.performanceBudget.cls).toBeLessThanOrEqual(0.1);
    expect(bp.preloader).toBe(false);
    expect(validateBlueprint({ businessGoal: "x", primaryAction: "y", preloader: true }).preloader).toBe(true);
  });

  it("blueprintSummary pokazuje cel, CTA i uzasadnienia sekcji", () => {
    const s = blueprintSummary(fallbackBlueprint({ business: "Alfa" }));
    expect(s).toMatch(/Cel:/);
    expect(s).toMatch(/CTA:/);
  });
});
