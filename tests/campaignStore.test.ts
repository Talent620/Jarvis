// === Trwałość kampanii (campaignStore) — testy ===
// Rdzeń czysty (upsert/remove/find) + wrappery na store. Kampanie mają id, są zapisywane, edytowalne,
// a zmiana statusu idzie przez campaignEngine (dozwolone przejścia + historia).
import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertCampaignIn, removeCampaignFrom, findCampaign,
  listCampaigns, saveCampaign, getCampaign, removeCampaign, setCampaignStatus,
} from "../src/lib/campaignStore";
import { newCampaign, type CampaignPlan } from "../src/lib/campaignEngine";
import { store } from "../src/lib/store";

const NOW = 18_000_000_000;
const utm = { source: "google", medium: "cpc", campaign: "test" };
const mk = (id: string): CampaignPlan => newCampaign({ id, type: "organic_post", audience: "a", offer: "o", channel: "instagram", creative: { headlines: ["h"], descriptions: ["d"] }, cta: "Zobacz", utm, now: NOW });

describe("campaignStore — rdzeń czysty", () => {
  it("upsert dodaje i aktualizuje po id; remove usuwa; find znajduje", () => {
    let list: CampaignPlan[] = [];
    list = upsertCampaignIn(list, mk("c1"));
    list = upsertCampaignIn(list, mk("c2"));
    expect(list).toHaveLength(2);
    list = upsertCampaignIn(list, { ...mk("c1"), audience: "nowa" }); // update, nie duplikat
    expect(list).toHaveLength(2);
    expect(findCampaign(list, "c1")?.audience).toBe("nowa");
    list = removeCampaignFrom(list, "c1");
    expect(findCampaign(list, "c1")).toBeUndefined();
  });
});

describe("campaignStore — trwałość w store", () => {
  beforeEach(() => { store.setData((d) => { d.campaigns = []; }); });

  it("save/get/list/remove działają na store", () => {
    saveCampaign(mk("c1"));
    saveCampaign(mk("c2"));
    expect(listCampaigns()).toHaveLength(2);
    expect(getCampaign("c1")?.id).toBe("c1");
    removeCampaign("c1");
    expect(getCampaign("c1")).toBeUndefined();
    expect(listCampaigns()).toHaveLength(1);
  });

  it("setCampaignStatus zmienia status przez engine (z historią) i utrwala", () => {
    saveCampaign(mk("c1"));
    const updated = setCampaignStatus("c1", "approved", NOW + 1, "zatwierdzone");
    expect(updated?.status).toBe("approved");
    expect(getCampaign("c1")?.status).toBe("approved");
    expect(getCampaign("c1")?.history).toHaveLength(1);
  });

  it("niedozwolone przejście statusu nie zmienia kampanii (bezpiecznie)", () => {
    saveCampaign(mk("c1")); // draft
    setCampaignStatus("c1", "published_confirmed", NOW + 1); // draft → published_confirmed zabronione
    expect(getCampaign("c1")?.status).toBe("draft");
  });

  it("status nieistniejącej kampanii → null", () => {
    expect(setCampaignStatus("nope", "approved", NOW)).toBeNull();
  });
});
