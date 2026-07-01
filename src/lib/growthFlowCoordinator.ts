// === Koordynator wzrostu (growthFlowCoordinator) ===
// JEDEN przepływ, którego używa UI/runtime — zamiast ręcznego sklejania modułów w każdym miejscu:
// KANDYDAT → IMPORT → SCORING → KONTEKST → BLUEPRINT → STRONA → WALIDACJA → OFERTA → KAMPANIA →
// ZGODA → PUBLIKACJA → PRZYCHÓD → ROI → REKOMENDACJA. Komponuje ISTNIEJĄCE, przetestowane moduły
// (nie dubluje ich). Rdzeń jest czysty (na tablicach) — wrapper utrwala w store. Reguły bezpieczeństwa:
// symulacja ZOSTAJE SIMULATED (nigdy PUBLISHED bez potwierdzonego LIVE), publikacja WYMAGA zgody,
// mock/no_persist nie wchodzi do CRM. S9-safe.

import type { Lead } from "../types";
import type { RawLead } from "./leads";
import { discoverLeadCandidates, importCandidates, type CandidateSource, type LeadCandidate } from "./leadCandidates";
import { scoreLead, signalsFromCandidate, signalsFromLead, type IcpScore } from "./leadScoring";
import { buildGrowthContext, growthContextToBrief } from "./growthContext";
import { fallbackBlueprint, validateBlueprint, type SiteBlueprint } from "./siteBlueprint";
import { resolve3D, type DeviceCaps, type Resolved3D, type ThreeDMode } from "./web3dPolicy";
import { validateSite } from "./siteValidator";
import { newCampaign, canExport, transitionCampaign, type CampaignPlan } from "./campaignEngine";
import { resolveChannelCapability, interpretPublishState } from "./platformCapabilities";
import { computeRoi, type RoiReport } from "./campaignRoi";

export type PublishState = "PUBLISHED_CONFIRMED" | "SIMULATED" | "BLOCKED";

export interface GrowthFlowInput {
  raw: RawLead;
  source: CandidateSource;
  now: number;
  three: { requested: ThreeDMode; caps: DeviceCaps };
  html: string;   // wygenerowana strona (wstrzyknięta — bez modelu w teście)
  offer: string;  // draft oferty (wstrzyknięty)
  consent: boolean;
  /** Kanał publikacji. Bez tokena → SIMULATED. LIVE tylko przy potwierdzonym receiptApiState. */
  channel?: { hasToken?: boolean; hasRequiredPermissions?: boolean; healthy?: boolean; receiptApiState?: string };
  /** Realizacja wygranej — przychód przypisany do kampanii. */
  won?: { revenue: number };
  makeId: (seed: string) => string;
}

export interface GrowthFlowResult {
  candidate: LeadCandidate;
  imported: boolean;
  lead: Lead;
  candidateScore: IcpScore;
  leadScore: IcpScore;
  blueprint: SiteBlueprint;
  threeD: Resolved3D;
  siteSafe: boolean;
  campaign: CampaignPlan;
  publish: { state: PublishState; reason: string };
  roi: RoiReport;
  recommendationVariant: string | null;
  leads: Lead[];      // zaktualizowana kolekcja (dowód zmiany store)
  campaigns: CampaignPlan[];
}

/**
 * Pure: przeprowadź jeden przepływ wzrostu na podanych kolekcjach i zwróć zaktualizowane + raport
 * z każdego etapu. Wywoływane przez wrapper na store (produkcja) oraz E2E (mocki sieci). Nie robi
 * żadnych operacji zewnętrznych — publikacja to stan (SIMULATED/PUBLISHED/BLOCKED), nie realny call.
 */
export function runGrowthFlow(input: GrowthFlowInput, prev: { leads: Lead[]; campaigns: CampaignPlan[] }): GrowthFlowResult {
  const now = input.now;
  // 1) Kandydat (bez zapisu) + scoring kandydata (provenance + kontaktowalność).
  const candidate = discoverLeadCandidates([input.raw], { source: input.source, now })[0];
  const candidateScore = scoreLead(signalsFromCandidate(candidate, now));

  // 2) Import → lead (mock/no_persist NIE wchodzi do CRM).
  const added = importCandidates(prev.leads, [candidate], { now, makeId: (c, i) => input.makeId(`${c.id}:${i}`) });
  const imported = added.length > 0;
  const leads = imported ? [...prev.leads, ...added] : prev.leads;
  const lead: Lead = imported ? added[0] : { id: input.makeId("nolead"), company: candidate.company, status: "new", createdAt: now, updatedAt: now };
  const leadScore = scoreLead(signalsFromLead(lead, now));

  // 3) Kontekst → brief → blueprint → 3D → walidacja strony.
  const ctx = buildGrowthContext(lead);
  const brief = growthContextToBrief(ctx);
  const blueprint = validateBlueprint(fallbackBlueprint(brief), brief);
  const threeD = resolve3D(input.three.requested, input.three.caps);
  const siteSafe = validateSite(input.html).safeToDownload;

  // 4) Kampania (paid_ad) — walidacja formatu przed eksportem; wspólne ID w utm.
  let campaign = newCampaign({
    id: input.makeId(`camp:${lead.id}`), type: "paid_ad", platform: "google_rsa",
    audience: ctx.company, offer: input.offer || "strona WWW", channel: "Google Ads",
    creative: { headlines: [`Nowa strona dla ${ctx.company}`.slice(0, 30), "Zwiększ zapytania"], descriptions: ["Nowoczesna strona, która pozyskuje klientów."] },
    cta: "Zapytaj", utm: { source: "google", medium: "cpc", campaign: lead.id, content: "A" }, variant: "A", landingPageId: `lp-${lead.id}`, now,
  });
  if (canExport(campaign).ok) campaign = transitionCampaign(campaign, "approved", now + 1);

  // 5) Zgoda → publikacja. Bez zgody: BLOCKED. Ze zgodą, bez potwierdzonego LIVE: SIMULATED.
  const publish = resolvePublish(input);
  if (publish.state === "PUBLISHED_CONFIRMED") campaign = transitionCampaign(transitionCampaign(campaign, "scheduled", now + 2), "published_confirmed", now + 3);

  const campaigns = upsert(prev.campaigns, campaign);

  // 6) Przychód (tylko realna wygrana) → ROI + rekomendacja z REALNEGO wyniku.
  let leads2 = leads;
  if (input.won && imported) {
    leads2 = leads.map((l) => (l.id === lead.id ? { ...l, status: "won" as const, value: input.won!.revenue, campaignId: campaign.id, updatedAt: now + 4 } : l));
  }
  const roi = computeRoi(campaigns, leads2, now + 5);
  const wonLead = leads2.find((l) => l.id === lead.id);

  return {
    candidate, imported, lead: wonLead || lead, candidateScore, leadScore,
    blueprint, threeD, siteSafe, campaign, publish, roi,
    recommendationVariant: roi.recommendation.variant,
    leads: leads2, campaigns,
  };
}

/** Pure: rozstrzygnij stan publikacji ze zgody + zdolności kanału. Symulacja zostaje SIMULATED. */
function resolvePublish(input: GrowthFlowInput): { state: PublishState; reason: string } {
  if (!input.consent) return { state: "BLOCKED", reason: "Brak zgody — nic nie publikujemy." };
  const ch = input.channel || {};
  const cap = resolveChannelCapability({ channel: "Google Ads", hasToken: ch.hasToken, hasRequiredPermissions: ch.hasRequiredPermissions, healthy: ch.healthy, supportsExport: true });
  if (cap.canPublishApi && interpretPublishState(ch.receiptApiState) === "LIVE")
    return { state: "PUBLISHED_CONFIRMED", reason: "Potwierdzony LIVE z API." };
  return { state: "SIMULATED", reason: "Brak potwierdzonego LIVE — publikacja pozostaje symulacją." };
}

function upsert(list: CampaignPlan[], plan: CampaignPlan): CampaignPlan[] {
  const arr = list || [];
  const i = arr.findIndex((c) => c.id === plan.id);
  if (i >= 0) { const next = arr.slice(); next[i] = plan; return next; }
  return [...arr, plan];
}

/**
 * Wrapper na store: uruchom przepływ na REALNYCH danych i utrwal wynik (leady + kampanie). To ścieżka,
 * którą wywołuje aplikacja — DOKŁADNIE ten sam runGrowthFlow, który sprawdza E2E. Zwraca pełny raport.
 */
export function runGrowthFlowOnStore(
  input: GrowthFlowInput,
  store: { data: { leads?: Lead[]; campaigns?: CampaignPlan[] }; setData: (fn: (d: { leads: Lead[]; campaigns?: CampaignPlan[] }) => void) => void },
): GrowthFlowResult {
  const res = runGrowthFlow(input, { leads: store.data.leads || [], campaigns: store.data.campaigns || [] });
  store.setData((d) => { d.leads = res.leads; d.campaigns = res.campaigns; });
  return res;
}
