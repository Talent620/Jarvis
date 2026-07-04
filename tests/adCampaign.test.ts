// === Reklama → strukturalna kampania (adCampaign) — testy ===
// Surowy tekst reklamy ma stać się PRAWDZIWYM CampaignPlan (paid_ad), z kreacją, wspólnym ID
// (campaignId ↔ utm.campaign) i walidacją formatu. To nie „luźny tekst zapisany jako post".
import { describe, it, expect } from "vitest";
import { mapAdPlatform, slugifyCampaign, parseAdCreative, buildAdCampaign, buildOrganicCampaign } from "../src/lib/adCampaign";
import { canExport, validateAdFormat } from "../src/lib/campaignEngine";

const GOOGLE_OUT = [
  "NAGŁÓWKI:",
  "1) Strona WWW w 48h",
  "2) Nowa strona dla firmy",
  "OPISY:",
  "1) Profesjonalna strona dla lokalnej firmy — szybko i tanio.",
  "SŁOWA KLUCZOWE:",
  "strona www, tania strona",
  "BUDŻET:",
  "30 zł/dzień",
].join("\n");

const META_OUT = [
  "TEKST GŁÓWNY:",
  "Twoja firma zasługuje na porządną stronę.",
  "NAGŁÓWEK:",
  "1) Strona w 48h",
  "OPIS:",
  "1) Zadzwoń dziś",
].join("\n");

describe("adCampaign — mapowanie i slug", () => {
  it("mapuje platformę UI na format reklamowy", () => {
    expect(mapAdPlatform("google")).toBe("google_rsa");
    expect(mapAdPlatform("meta")).toBe("meta");
  });
  it("slug jest S9-safe: polskie znaki → ascii, spacje → myślnik", () => {
    expect(slugifyCampaign("Wiosną 2026 — Kraków")).toBe("wiosna-2026-krakow");
    expect(slugifyCampaign("")).toBe("");
  });
});

describe("adCampaign — parser kreacji", () => {
  it("wyłuskuje nagłówki i opisy z Google, pomija słowa kluczowe/budżet", () => {
    const c = parseAdCreative(GOOGLE_OUT);
    expect(c.headlines).toEqual(["Strona WWW w 48h", "Nowa strona dla firmy"]);
    expect(c.descriptions).toEqual(["Profesjonalna strona dla lokalnej firmy — szybko i tanio."]);
  });
  it("wyłuskuje tekst główny z Meta", () => {
    const c = parseAdCreative(META_OUT);
    expect(c.primaryText).toMatch(/porządną stronę/);
    expect(c.headlines).toEqual(["Strona w 48h"]);
  });
});

describe("adCampaign — buildAdCampaign tworzy prawdziwy plan", () => {
  it("plan to paid_ad w statusie draft, campaignId = utm.campaign", () => {
    const plan = buildAdCampaign({ id: "cmp1", uiPlatform: "google", product: "Strony WWW dla firm", rawText: GOOGLE_OUT, now: 1000 });
    expect(plan.type).toBe("paid_ad");
    expect(plan.platform).toBe("google_rsa");
    expect(plan.status).toBe("draft");
    expect(plan.utm.campaign).toBe("strony-www-dla-firm");
    expect(plan.creative.headlines.length).toBe(2);
  });
  it("kreacja przechodzi walidację formatu (krótkie nagłówki) → canExport ok", () => {
    const plan = buildAdCampaign({ id: "cmp2", uiPlatform: "google", product: "Strony WWW", rawText: GOOGLE_OUT, now: 1000 });
    expect(canExport(plan).ok).toBe(true);
  });
  it("za długi nagłówek jest odrzucany PRZED eksportem", () => {
    const longOut = "NAGŁÓWKI:\n1) " + "x".repeat(40) + "\nOPISY:\n1) ok";
    const plan = buildAdCampaign({ id: "cmp3", uiPlatform: "google", product: "X", rawText: longOut, now: 1 });
    expect(validateAdFormat("google_rsa", plan.creative).ok).toBe(false);
  });

  it("post organiczny to INNY typ (organic_post) — nie reklama płatna", () => {
    const p = buildOrganicCampaign({ id: "o1", channel: "Instagram", topic: "Nowa oferta wiosenna", text: "Treść posta", now: 1 });
    expect(p.type).toBe("organic_post");
    expect(p.platform).toBeUndefined();
    expect(canExport(p).ok).toBe(true); // organic nie ma twardego formatu reklamowego
    expect(p.utm.medium).toBe("social");
  });
});
