import { describe, it, expect } from "vitest";
import { searchKnowledge, tokenize, expandTerms, type KnowledgeIndex } from "../src/lib/projectKnowledge";

const idx: KnowledgeIndex = {
  fileCount: 0,
  byKind: {},
  files: [
    { path: "src/lib/finance.ts", kind: "lib", loc: 119, exports: ["financeKpis", "monthlyRevenue"], summary: "silnik liczący zysk marża VAT" },
    { path: "src/lib/voice.ts", kind: "lib", loc: 856, exports: ["speak", "makeDistortionCurve"], summary: "synteza mowy TTS i efekt Kapitana" },
    { path: "src/components/Settings.tsx", kind: "component", loc: 3015, exports: ["default"], summary: "panel ustawień" },
    { path: "src/lib/mailer.ts", kind: "lib", loc: 360, exports: ["sendOfferEmail", "buildSentIndex"], summary: "wysyłka maili wielokanałowa" },
    { path: "tests/finance.test.ts", kind: "test", loc: 50, exports: [], summary: "testy finansów" },
  ],
};

describe("projectKnowledge — tokenize / expandTerms", () => {
  it("tokenizuje pytanie PL (S9-safe, bez /u)", () => {
    expect(tokenize("Gdzie liczone są PIENIĄDZE?")).toContain("pieniądze");
    expect(tokenize("a, b")).toEqual([]); // 1-znakowe odpadają
  });
  it("rozszerza pojęcie o domenę (pieniądze → finance)", () => {
    expect(expandTerms(["pieniądze"])).toContain("finance");
    expect(expandTerms(["głos"])).toContain("tts");
  });
});

describe("projectKnowledge — searchKnowledge (Developer Copilot)", () => {
  it("„gdzie liczone są pieniądze?” → finance.ts na szczycie", () => {
    const hits = searchKnowledge(idx, "gdzie liczone są pieniądze?");
    expect(hits[0].path).toBe("src/lib/finance.ts");
    expect(hits[0].why).toMatch(/finance|kpi|cost|money/);
  });
  it("„pokaż wszystko od voice” → voice.ts", () => {
    const hits = searchKnowledge(idx, "pokaż wszystko od voice");
    expect(hits[0].path).toBe("src/lib/voice.ts");
  });
  it("„to okno ustawień” → Settings.tsx", () => {
    const hits = searchKnowledge(idx, "to okno ustawień jest ogromne");
    expect(hits.some((h) => h.path === "src/components/Settings.tsx")).toBe(true);
  });
  it("pomija pliki testowe w nawigacji", () => {
    const hits = searchKnowledge(idx, "finanse");
    expect(hits.some((h) => h.kind === "test")).toBe(false);
  });
  it("puste/nieznane pytanie → brak trafień", () => {
    expect(searchKnowledge(idx, "")).toEqual([]);
    expect(searchKnowledge(idx, "xyzqwk")).toEqual([]);
  });
});
