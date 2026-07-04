// === Jeden Marketing (marketingModel) — testy ===
// Cztery zakładki; statusy jednoznaczne; SIMULATED nigdy nie jest PUBLISHED; jedna główna akcja na rekord.
import { describe, it, expect } from "vitest";
import { MARKETING_TABS, campaignStatusLabel, simulatedLabel, isPublishedConfirmed, campaignMainAction } from "../src/lib/marketingModel";

describe("marketingModel — zakładki", () => {
  it("dokładnie cztery: Treści, Kampanie, Marka, Wyniki", () => {
    expect(MARKETING_TABS.map((t) => t.id)).toEqual(["content", "campaigns", "brand", "results"]);
  });
});

describe("marketingModel — statusy jednoznaczne", () => {
  it("etykiety pokrywają cały cykl życia; eksport ≠ potwierdzone", () => {
    expect(campaignStatusLabel("draft")).toBe("szkic");
    expect(campaignStatusLabel("exported")).toBe("wyeksportowane");
    expect(campaignStatusLabel("published_confirmed")).toBe("potwierdzone");
    expect(campaignStatusLabel("exported")).not.toBe(campaignStatusLabel("published_confirmed"));
  });

  it("SIMULATED to symulacja i NIGDY nie jest potwierdzoną publikacją", () => {
    expect(simulatedLabel()).toBe("symulacja");
    expect(isPublishedConfirmed("exported")).toBe(false);
    expect(isPublishedConfirmed("published_confirmed")).toBe(true);
  });
});

describe("marketingModel — jedna główna akcja na rekord", () => {
  it("akcja zależy od statusu i prowadzi do kolejnego bezpiecznego kroku", () => {
    expect(campaignMainAction({ status: "draft" }).to).toBe("approved");
    expect(campaignMainAction({ status: "approved" }).to).toBe("exported");
    expect(campaignMainAction({ status: "exported" }).to).toBe("published_confirmed");
    expect(campaignMainAction({ status: "published_confirmed" }).to).toBeNull();
    expect(campaignMainAction({ status: "failed" }).to).toBe("draft");
  });
});
