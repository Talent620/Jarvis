// === Trwałość kampanii (campaignStore) ===
// campaignEngine to model; tu robimy z kampanii REALNE, zapisywane obiekty (twórz/edytuj/status/usuń).
// Rdzeń operacji jest CZYSTY (na tablicy), a cienkie wrappery utrwalają w store.data.campaigns.
// Dzięki temu kampanie mają id, przeżywają zamknięcie aplikacji i mogą karmić pętlę ROI. S9-safe.

import { store } from "./store";
import { transitionCampaign, type CampaignPlan, type CampaignStatus } from "./campaignEngine";

// — Rdzeń czysty (operacje na tablicy) —

/** Pure: wstaw/zaktualizuj kampanię po id (dedup). */
export function upsertCampaignIn(list: CampaignPlan[], plan: CampaignPlan): CampaignPlan[] {
  const arr = list || [];
  const i = arr.findIndex((c) => c.id === plan.id);
  if (i >= 0) { const next = arr.slice(); next[i] = plan; return next; }
  return [...arr, plan];
}

/** Pure: usuń kampanię po id. */
export function removeCampaignFrom(list: CampaignPlan[], id: string): CampaignPlan[] {
  return (list || []).filter((c) => c.id !== id);
}

/** Pure: znajdź kampanię po id. */
export function findCampaign(list: CampaignPlan[], id: string): CampaignPlan | undefined {
  return (list || []).find((c) => c.id === id);
}

// — Wrappery na store (trwałość) —

export function listCampaigns(): CampaignPlan[] {
  return store.data.campaigns || [];
}

export function getCampaign(id: string): CampaignPlan | undefined {
  return findCampaign(listCampaigns(), id);
}

export function saveCampaign(plan: CampaignPlan): void {
  store.setData((d) => { d.campaigns = upsertCampaignIn(d.campaigns || [], plan); });
}

export function removeCampaign(id: string): void {
  store.setData((d) => { d.campaigns = removeCampaignFrom(d.campaigns || [], id); });
}

/** Zmień status kampanii (przez campaignEngine.transitionCampaign) i utrwal. Zwraca zaktualizowaną (lub null). */
export function setCampaignStatus(id: string, to: CampaignStatus, now: number, note?: string): CampaignPlan | null {
  const cur = getCampaign(id);
  if (!cur) return null;
  const next = transitionCampaign(cur, to, now, note);
  saveCampaign(next);
  return next;
}
