// === Most Lead → demo (growthContext) — testy ===
// Marcin nie przepisuje ręcznie informacji o leadzie. Sprawdzamy: budowę kontekstu z leada,
// wykrywanie problemów, mapowanie na brief kreatora i to, że zwykłe wejście (brak leada) daje pusto.
import { describe, it, expect } from "vitest";
import { buildGrowthContext, detectProblems, growthContextToBrief, demoProjectName } from "../src/lib/growthContext";
import type { Lead } from "../src/types";

const NOW = 9_000_000;
const lead = (over: Partial<Lead>): Lead => ({ id: "L1", company: "Firma X", status: "new", createdAt: NOW, updatedAt: NOW, ...over });

describe("growthContext — budowa kontekstu z leada", () => {
  it("przenosi firmę, branżę, lokalizację, stronę i kontakt", () => {
    const ctx = buildGrowthContext(lead({ company: "Kowalski Bud", niche: "budowlana", location: "Kraków", url: "https://kb.example", email: "biuro@kb.example" }));
    expect(ctx.company).toBe("Kowalski Bud");
    expect(ctx.industry).toBe("budowlana");
    expect(ctx.location).toBe("Kraków");
    expect(ctx.website).toBe("https://kb.example");
    expect(ctx.contact).toBe("biuro@kb.example");
    expect(ctx.leadId).toBe("L1");
  });

  it("wykrywa problemy: brak strony i brak e-maila", () => {
    const problems = detectProblems(lead({ url: undefined, email: undefined }));
    expect(problems.join(" ")).toMatch(/brak strony/i);
    expect(problems.join(" ")).toMatch(/e-mail/i);
  });

  it("wykrywa problemy z audytu strony (mobile/HTTPS)", () => {
    const problems = detectProblems(lead({ url: "https://x.example", email: "a@x.example", intel: { score: 40, audit: { ok: true, viewport: false, https: false }, updatedAt: NOW } }));
    expect(problems.join(" ")).toMatch(/mobiln/i);
    expect(problems.join(" ")).toMatch(/HTTPS/i);
  });
});

describe("growthContext — mapowanie na brief kreatora", () => {
  it("brief zawiera firmę, cel i wykryte problemy (bez ręcznego wpisywania)", () => {
    const ctx = buildGrowthContext(lead({ company: "Alfa", niche: "gastronomia", url: undefined, email: undefined }));
    const brief = growthContextToBrief(ctx);
    expect(brief.business).toBe("Alfa");
    expect(brief.industry).toBe("gastronomia");
    expect(brief.goal).toMatch(/demo/i);
    expect(brief.extra).toMatch(/Problemy do rozwiązania/i);
  });

  it("nazwa projektu demo bierze firmę", () => {
    expect(demoProjectName(buildGrowthContext(lead({ company: "Beta" })))).toBe("Demo — Beta");
  });
});
