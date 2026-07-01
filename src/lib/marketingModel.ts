// === Jeden Marketing — model workspace'u (marketingModel) ===
// Cztery zakładki: Treści | Kampanie | Marka | Wyniki. Status KAŻDEJ rzeczy jest jednoznaczny, a
// SIMULATED (symulacja) NIGDY nie jest PUBLISHED. Jedna główna akcja na rekord. Czyste i testowalne.
// Komponuje istniejący campaignEngine (nie duplikuje modelu). S9-safe.

import type { CampaignStatus, CampaignPlan } from "./campaignEngine";

export type MarketingTab = "content" | "campaigns" | "brand" | "results";

export const MARKETING_TABS: { id: MarketingTab; label: string }[] = [
  { id: "content", label: "📱 Treści" },
  { id: "campaigns", label: "📢 Kampanie" },
  { id: "brand", label: "🎨 Marka" },
  { id: "results", label: "💸 Wyniki" },
];

// Jednoznaczne etykiety statusu (po ludzku). „exported" ≠ „published_confirmed" — eksport to nie publikacja.
const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "szkic",
  approved: "zatwierdzone",
  scheduled: "zaplanowane",
  exported: "wyeksportowane",
  published_confirmed: "potwierdzone",
  failed: "błąd",
};

/** Pure: etykieta statusu kampanii. Symulacja jest osobnym słowem (patrz simulatedLabel). */
export function campaignStatusLabel(status: CampaignStatus): string {
  return CAMPAIGN_STATUS_LABEL[status] ?? status;
}

/** Pure: etykieta dla stanu SIMULATED — zawsze „symulacja", NIGDY „potwierdzone/opublikowane". */
export function simulatedLabel(): string {
  return "symulacja";
}

/** Pure: czy dany status wolno pokazać jako POTWIERDZONĄ publikację? Tylko published_confirmed. */
export function isPublishedConfirmed(status: CampaignStatus): boolean {
  return status === "published_confirmed";
}

export interface MainAction { label: string; to: CampaignStatus | null }

/** Pure: JEDNA główna akcja dla rekordu kampanii wg statusu (następny bezpieczny krok). */
export function campaignMainAction(plan: Pick<CampaignPlan, "status">): MainAction {
  switch (plan.status) {
    case "draft": return { label: "✅ Zatwierdź", to: "approved" };
    case "approved": return { label: "📤 Eksportuj", to: "exported" };
    case "scheduled": return { label: "📤 Eksportuj", to: "exported" };
    case "exported": return { label: "🔗 Oznacz potwierdzone (po publikacji)", to: "published_confirmed" };
    case "published_confirmed": return { label: "✓ Opublikowane", to: null };
    case "failed": return { label: "🔁 Ponów", to: "draft" };
    default: return { label: "—", to: null };
  }
}
