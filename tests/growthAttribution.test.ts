// === Zamknięta pętla ROI (growthAttribution) — testy ===
// JARVIS wie, które działania przynoszą pieniądze. Wygrany lead przypisuje przychód do kampanii i
// strony; BRAK identyfikatora nie tworzy fałszywej atrybucji. Lejek i rekomendacja z realnego wyniku.
import { describe, it, expect } from "vitest";
import { buildFunnel, attributeRevenue, recommendVariant, stageConversion, type AttributionEvent } from "../src/lib/growthAttribution";

const NOW = 13_000_000_000;
const ev = (over: Partial<AttributionEvent>): AttributionEvent => ({ stage: "impression", at: NOW, link: {}, ...over });

describe("growthAttribution — lejek", () => {
  it("liczy zdarzenia na etapach i konwersję między nimi", () => {
    const events = [
      ev({ stage: "impression" }), ev({ stage: "impression" }), ev({ stage: "click" }),
      ev({ stage: "lead" }), ev({ stage: "win" }),
    ];
    const f = buildFunnel(events);
    expect(f.impression).toBe(2);
    expect(f.click).toBe(1);
    expect(stageConversion(f, "impression", "click")).toBe(0.5);
  });
});

describe("growthAttribution — atrybucja przychodu", () => {
  it("wygrany lead przypisuje przychód do kampanii i strony", () => {
    const events = [ev({ stage: "payment", revenue: 5000, link: { campaignId: "camp1", landingPageId: "lp1", variant: "A" } })];
    const a = attributeRevenue(events);
    expect(a.byCampaign["camp1"]).toBe(5000);
    expect(a.byLandingPage["lp1"]).toBe(5000);
    expect(a.total).toBe(5000);
    expect(a.unattributed).toBe(0);
  });

  it("brak identyfikatora → przychód NIEprzypisany (bez fałszywej atrybucji)", () => {
    const a = attributeRevenue([ev({ stage: "payment", revenue: 3000, link: {} })]);
    expect(a.unattributed).toBe(3000);
    expect(Object.keys(a.byCampaign)).toHaveLength(0);
  });

  it("sumuje wiele wpłat na tę samą kampanię", () => {
    const a = attributeRevenue([
      ev({ stage: "payment", revenue: 2000, link: { campaignId: "c" } }),
      ev({ stage: "payment", revenue: 1000, link: { campaignId: "c" } }),
    ]);
    expect(a.byCampaign["c"]).toBe(3000);
  });
});

describe("growthAttribution — rekomendacja wariantu z realnego wyniku", () => {
  it("wskazuje wariant o najwyższym potwierdzonym przychodzie z uzasadnieniem", () => {
    const events = [
      ev({ stage: "payment", revenue: 8000, link: { variant: "A" } }),
      ev({ stage: "payment", revenue: 3000, link: { variant: "B" } }),
    ];
    const r = recommendVariant(events);
    expect(r.variant).toBe("A");
    expect(r.revenue).toBe(8000);
    expect(r.reason).toMatch(/wariant/i);
  });

  it("brak danych o przychodzie → brak rekomendacji (nie zgaduje)", () => {
    const r = recommendVariant([ev({ stage: "impression", link: { variant: "A" } })]);
    expect(r.variant).toBeNull();
  });
});
