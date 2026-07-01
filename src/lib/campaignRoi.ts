// === ROI z realnego store (campaignRoi) ===
// Komponuje growthAttribution NAD prawdziwymi danymi aplikacji: kampanie (store.data.campaigns) i leady
// (store.data.leads). Wygrany lead z wartością i przypisaną kampanią (campaignId) tworzy zdarzenie
// win+payment — przychód przypisany do kampanii. Brak campaignId → „nieprzypisane" (nie zmyślamy).
// To NIE nowy silnik — to adapter store nad growthAttribution (jak campaignStore nad campaignEngine).
// Czyste jądro (na tablicach) + cienki wrapper na store. S9-safe.

import type { CampaignPlan } from "./campaignEngine";
import type { Lead } from "../types";
import { attributeRevenue, buildFunnel, recommendVariant, type AttributionEvent, type FunnelStage, type RevenueAttribution, type VariantRecommendation } from "./growthAttribution";
import { store } from "./store";

/**
 * Pure: zbuduj zdarzenia atrybucji z realnych obiektów. Każda kampania = wejście lejka (impression).
 * Wygrany lead z wartością → win + payment (przychód) przypisany po campaignId leada.
 */
export function eventsFromStore(campaigns: CampaignPlan[], leads: Lead[], now: number): AttributionEvent[] {
  const events: AttributionEvent[] = [];
  for (const c of campaigns || []) {
    events.push({ stage: "impression", at: c.createdAt || now, link: { campaignId: c.id, utm: c.utm, landingPageId: c.landingPageId, variant: c.variant } });
  }
  for (const l of leads || []) {
    const link = { campaignId: l.campaignId, leadId: l.id };
    if (l.campaignId) events.push({ stage: "lead", at: l.createdAt || now, link });
    if (l.status === "won") {
      const rev = typeof l.value === "number" && l.value > 0 ? l.value : 0;
      // Przychód nosi WYŁĄCZNIE zdarzenie payment (win to samo domknięcie) — bez podwójnego liczenia.
      events.push({ stage: "win", at: l.updatedAt || now, link });
      events.push({ stage: "payment", at: l.updatedAt || now, link, revenue: rev });
    }
  }
  return events;
}

export interface RoiReport {
  attribution: RevenueAttribution;
  funnel: Record<FunnelStage, number>;
  recommendation: VariantRecommendation;
  /** Przychód per kampania z czytelną nazwą (offer) — do UI. */
  byCampaignNamed: { id: string; name: string; revenue: number }[];
}

/** Pure: pełny raport ROI z podanych obiektów (testowalne bez store). */
export function computeRoi(campaigns: CampaignPlan[], leads: Lead[], now: number): RoiReport {
  const events = eventsFromStore(campaigns, leads, now);
  const attribution = attributeRevenue(events);
  const nameOf = (id: string) => (campaigns || []).find((c) => c.id === id)?.offer || id;
  const byCampaignNamed = Object.entries(attribution.byCampaign)
    .map(([id, revenue]) => ({ id, name: nameOf(id), revenue }))
    .sort((a, b) => b.revenue - a.revenue);
  return { attribution, funnel: buildFunnel(events), recommendation: recommendVariant(events), byCampaignNamed };
}

/** Wrapper na store: raport ROI z realnych kampanii i leadów. */
export function buildRoiReport(now: number): RoiReport {
  return computeRoi(store.data.campaigns || [], store.data.leads || [], now);
}
