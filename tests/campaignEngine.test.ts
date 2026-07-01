// === Jeden model kampanii (campaignEngine) — testy ===
// Marcin widzi JEDNĄ kampanię. Za długi nagłówek Google jest odrzucany PRZED eksportem; draft reklamy
// NIE jest opublikowanym postem; reklama płatna i post organiczny to różne typy; historia zmian działa.
import { describe, it, expect } from "vitest";
import { validateAdFormat, canExport, transitionCampaign, budgetFromAssumptions, newCampaign, type CampaignCreative } from "../src/lib/campaignEngine";

const NOW = 12_000_000_000;
const utm = { source: "google", medium: "cpc", campaign: "wiosna" };
const okCreative: CampaignCreative = { headlines: ["Krótki nagłówek", "Drugi nagłówek"], descriptions: ["Zwięzły opis oferty poniżej limitu."] };

describe("campaignEngine — walidacja formatów", () => {
  it("za długi nagłówek Google (>30) → błąd, brak eksportu", () => {
    const bad: CampaignCreative = { headlines: ["Ten nagłówek jest zdecydowanie zbyt długi na Google RSA"], descriptions: ["ok"] };
    const v = validateAdFormat("google_rsa", bad);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/za długi/i);
  });

  it("poprawna kreacja Google przechodzi", () => {
    expect(validateAdFormat("google_rsa", okCreative).ok).toBe(true);
  });

  it("Meta: za długi primary text → błąd", () => {
    const v = validateAdFormat("meta", { headlines: ["Nagłówek"], descriptions: [], primaryText: "x".repeat(200) });
    expect(v.ok).toBe(false);
  });

  it("canExport blokuje eksport reklamy z błędnym formatem", () => {
    const plan = newCampaign({ id: "c1", type: "paid_ad", platform: "google_rsa", audience: "a", offer: "o", channel: "google", creative: { headlines: ["x".repeat(40)], descriptions: [] }, cta: "Kup", utm, now: NOW });
    expect(canExport(plan).ok).toBe(false);
  });
});

describe("campaignEngine — cykl życia (draft ≠ opublikowany)", () => {
  it("nowa kampania jest DRAFT, nie opublikowana", () => {
    const plan = newCampaign({ id: "c1", type: "organic_post", audience: "a", offer: "o", channel: "instagram", creative: okCreative, cta: "Sprawdź", utm, now: NOW });
    expect(plan.status).toBe("draft");
  });

  it("reklama płatna i post organiczny to różne typy", () => {
    const ad = newCampaign({ id: "a", type: "paid_ad", platform: "meta", audience: "x", offer: "y", channel: "meta", creative: okCreative, cta: "Kup", utm, now: NOW });
    const post = newCampaign({ id: "b", type: "organic_post", audience: "x", offer: "y", channel: "instagram", creative: okCreative, cta: "Zobacz", utm, now: NOW });
    expect(ad.type).not.toBe(post.type);
  });

  it("transitionCampaign zapisuje historię; niedozwolone przeskoki są blokowane", () => {
    let plan = newCampaign({ id: "c1", type: "organic_post", audience: "a", offer: "o", channel: "fb", creative: okCreative, cta: "x", utm, now: NOW });
    // draft → published_confirmed NIE jest dozwolone bezpośrednio
    const jumped = transitionCampaign(plan, "published_confirmed", NOW + 1);
    expect(jumped.status).toBe("draft"); // zablokowane
    plan = transitionCampaign(plan, "approved", NOW + 2, "zatwierdzone przez Marcina");
    expect(plan.status).toBe("approved");
    expect(plan.history).toHaveLength(1);
    expect(plan.history[0].note).toMatch(/zatwierdzone/);
  });
});

describe("campaignEngine — budżet", () => {
  it("z jawnych założeń → policzony, isSuggestion=false", () => {
    const b = budgetFromAssumptions({ dailyClicks: 10, cpc: 2, days: 7 });
    expect(b.amount).toBe(140);
    expect(b.isSuggestion).toBe(false);
  });

  it("bez danych → sugestia", () => {
    expect(budgetFromAssumptions({}).isSuggestion).toBe(true);
  });
});
