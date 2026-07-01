// === ROI z realnego store (campaignRoi) — testy ===
// Przychód przypisywany jest do kampanii TYLKO przez wspólne ID (lead.campaignId). Wygrana bez ID →
// „nieprzypisane". Raport liczy się z prawdziwych obiektów (kampanie + leady), nie z liczby treści.
import { describe, it, expect } from "vitest";
import { computeRoi, eventsFromStore } from "../src/lib/campaignRoi";
import { newCampaign, type CampaignPlan } from "../src/lib/campaignEngine";
import type { Lead } from "../src/types";

const NOW = 5_000;
const cmp = (id: string, offer: string, variant?: string): CampaignPlan =>
  newCampaign({ id, type: "paid_ad", platform: "google_rsa", audience: "a", offer, channel: "Google Ads", creative: { headlines: [], descriptions: [] }, cta: "x", utm: { source: "google", medium: "cpc", campaign: id }, variant, now: NOW });
const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "X", status: "new", createdAt: NOW, updatedAt: NOW, ...over });

describe("campaignRoi — atrybucja z realnych obiektów", () => {
  it("wygrany lead z wartością i campaignId → przychód przypisany do kampanii", () => {
    const campaigns = [cmp("c1", "Strony WWW")];
    const leads = [lead({ id: "l1", status: "won", value: 3000, campaignId: "c1" })];
    const r = computeRoi(campaigns, leads, NOW);
    expect(r.attribution.byCampaign.c1).toBe(3000);
    expect(r.attribution.total).toBe(3000);
    expect(r.byCampaignNamed[0]).toEqual({ id: "c1", name: "Strony WWW", revenue: 3000 });
  });

  it("wygrana BEZ campaignId → nieprzypisane (nie zmyślamy atrybucji)", () => {
    const r = computeRoi([cmp("c1", "A")], [lead({ id: "l2", status: "won", value: 1000 })], NOW);
    expect(r.attribution.unattributed).toBe(1000);
    expect(Object.keys(r.attribution.byCampaign).length).toBe(0);
  });

  it("lejek liczy wejścia; niewygrany lead nie daje przychodu", () => {
    const events = eventsFromStore([cmp("c1", "A")], [lead({ campaignId: "c1", status: "new" })], NOW);
    expect(events.some((e) => e.stage === "impression")).toBe(true);
    expect(events.some((e) => e.stage === "payment")).toBe(false);
  });
});
