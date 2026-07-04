// === Zamknięta pętla ROI (growthAttribution) ===
// JARVIS wie, które działania przynoszą PIENIĄDZE. Łączy campaignId, utm, landingPageId, leadId,
// offerId, projectId i przychód w jeden lejek: wyświetlenie → klik → lead → rozmowa → oferta →
// wygrana → zapłata. Przychód przypisujemy TYLKO, gdy jest identyfikator — brak ID NIE tworzy
// fałszywej atrybucji. Rekomendacje uczą się z REALNEGO wyniku (przychód), nie z liczby wygenerowanych
// treści, i mówią „dlaczego ten wariant". Import konwersji do platform to osobny, zatwierdzany krok.
// Czyste i testowalne. S9-safe.

import type { CampaignUtm } from "./campaignEngine";

export type FunnelStage = "impression" | "click" | "lead" | "conversation" | "offer" | "win" | "payment";

export interface AttributionLink {
  campaignId?: string;
  utm?: CampaignUtm;
  landingPageId?: string;
  leadId?: string;
  offerId?: string;
  projectId?: string;
  variant?: string;
}

export interface AttributionEvent {
  stage: FunnelStage;
  at: number;
  link: AttributionLink;
  revenue?: number; // tylko dla payment/win z realną kwotą
}

const STAGES: FunnelStage[] = ["impression", "click", "lead", "conversation", "offer", "win", "payment"];

/** Pure: lejek — liczba zdarzeń na każdym etapie (do wglądu i diagnozy wąskich gardeł). */
export function buildFunnel(events: AttributionEvent[]): Record<FunnelStage, number> {
  const out = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<FunnelStage, number>;
  for (const e of events || []) if (out[e.stage] != null) out[e.stage] += 1;
  return out;
}

export interface RevenueAttribution {
  byCampaign: Record<string, number>;
  byLandingPage: Record<string, number>;
  byVariant: Record<string, number>;
  unattributed: number; // przychód bez identyfikatora — NIE zmyślamy przypisania
  total: number;
}

/**
 * Pure: przypisz przychód do kampanii/strony/wariantu. Wymagany identyfikator — zdarzenie z przychodem
 * BEZ campaignId/landingPageId trafia do „unattributed" (nigdy nie tworzymy fałszywej atrybucji).
 */
export function attributeRevenue(events: AttributionEvent[]): RevenueAttribution {
  const byCampaign: Record<string, number> = {};
  const byLandingPage: Record<string, number> = {};
  const byVariant: Record<string, number> = {};
  let unattributed = 0;
  let total = 0;
  for (const e of events || []) {
    const rev = typeof e.revenue === "number" && e.revenue > 0 ? e.revenue : 0;
    if (!rev) continue;
    total += rev;
    let attributed = false;
    if (e.link.campaignId) { byCampaign[e.link.campaignId] = (byCampaign[e.link.campaignId] || 0) + rev; attributed = true; }
    if (e.link.landingPageId) { byLandingPage[e.link.landingPageId] = (byLandingPage[e.link.landingPageId] || 0) + rev; attributed = true; }
    if (e.link.variant) byVariant[e.link.variant] = (byVariant[e.link.variant] || 0) + rev;
    if (!attributed) unattributed += rev; // brak ID → uczciwie „nieprzypisane"
  }
  return { byCampaign, byLandingPage, byVariant, unattributed, total };
}

export interface VariantRecommendation {
  variant: string | null;
  reason: string;
  revenue: number;
}

/**
 * Pure: rekomenduj wariant na podstawie REALNEGO przychodu (nie liczby wygenerowanych treści).
 * Zwraca też „dlaczego". Brak danych o przychodzie → brak rekomendacji (nie zgadujemy).
 */
export function recommendVariant(events: AttributionEvent[]): VariantRecommendation {
  const { byVariant } = attributeRevenue(events);
  const entries = Object.entries(byVariant).sort((a, b) => b[1] - a[1]);
  if (!entries.length || entries[0][1] <= 0) return { variant: null, reason: "Za mało danych o przychodzie — nie rekomenduję wariantu na wyrost.", revenue: 0 };
  const [variant, revenue] = entries[0];
  const runnerUp = entries[1]?.[1] || 0;
  const lead = runnerUp > 0 ? `${Math.round(((revenue - runnerUp) / runnerUp) * 100)}% więcej przychodu niż następny` : "najwyższy potwierdzony przychód";
  return { variant, reason: `Wariant „${variant}" ma ${lead}.`, revenue };
}

/** Pure: współczynnik konwersji między dwoma etapami lejka (0 gdy brak wejść). */
export function stageConversion(funnel: Record<FunnelStage, number>, from: FunnelStage, to: FunnelStage): number {
  const a = funnel[from] || 0;
  const b = funnel[to] || 0;
  return a > 0 ? Math.round((b / a) * 1000) / 1000 : 0;
}
