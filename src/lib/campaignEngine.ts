// === Jeden model kampanii dla reklam i social (campaignEngine) ===
// Marcin widzi JEDNĄ kampanię, a nie kilka niepowiązanych generatorów tekstu. CampaignPlan łączy
// odbiorcę, ofertę, landing, kanał, kreację, CTA, UTM, budżet, KPI, wariant, dowody, ryzyka i status
// akceptacji. Reklama PŁATNA i post ORGANICZNY to różne typy. Deterministyczne walidatory formatów
// (Google RSA, Meta, LinkedIn, TikTok) odrzucają np. za długi nagłówek PRZED eksportem. Wygenerowany
// tekst NIGDY nie jest zapisywany jako „opublikowany". Cykl życia ma historię zmian. Czyste, S9-safe.

export type CampaignType = "paid_ad" | "organic_post";
export type AdPlatform = "google_rsa" | "meta" | "linkedin" | "tiktok";
// Cykl życia — brak „published" bez potwierdzenia (to osobny stan connectora).
export type CampaignStatus = "draft" | "approved" | "scheduled" | "exported" | "published_confirmed" | "failed";

export interface CampaignCreative {
  headlines: string[];
  descriptions: string[];
  primaryText?: string;
}

export interface CampaignUtm { source: string; medium: string; campaign: string; content?: string }

export interface CampaignBudget {
  amount?: number;
  currency?: string;
  isSuggestion: boolean; // true = sugestia AI bez twardych danych
  assumption?: string;   // jawne założenie, z którego wyliczono budżet
}

export interface CampaignHistoryEntry { at: number; from: CampaignStatus; to: CampaignStatus; note?: string }

export interface CampaignPlan {
  id: string;
  type: CampaignType;
  platform?: AdPlatform;
  audience: string;
  offer: string;
  landingPageId?: string;
  channel: string;
  creative: CampaignCreative;
  cta: string;
  utm: CampaignUtm;
  budget: CampaignBudget;
  kpi: string[];
  variant?: string;
  evidence: string[];
  risks: string[];
  status: CampaignStatus;
  history: CampaignHistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

// Deterministyczne limity formatów (wg dokumentacji platform). Nagłówek/opis w znakach.
interface FormatLimits { headlineMax: number; headlineCount: number; descriptionMax: number; descriptionCount: number; primaryTextMax?: number }
const LIMITS: Record<AdPlatform, FormatLimits> = {
  google_rsa: { headlineMax: 30, headlineCount: 15, descriptionMax: 90, descriptionCount: 4 },
  meta: { headlineMax: 40, headlineCount: 5, descriptionMax: 30, descriptionCount: 5, primaryTextMax: 125 },
  linkedin: { headlineMax: 70, headlineCount: 1, descriptionMax: 100, descriptionCount: 1, primaryTextMax: 150 },
  tiktok: { headlineMax: 0, headlineCount: 0, descriptionMax: 100, descriptionCount: 1, primaryTextMax: 100 },
};

export interface FormatValidation { ok: boolean; errors: string[] }

/** Pure: zwaliduj kreację pod format platformy. Za długi nagłówek/opis → błąd (odrzucamy PRZED eksportem). */
export function validateAdFormat(platform: AdPlatform, creative: CampaignCreative): FormatValidation {
  const lim = LIMITS[platform];
  const errors: string[] = [];
  const heads = creative.headlines || [];
  const descs = creative.descriptions || [];

  if (lim.headlineCount > 0 && heads.length > lim.headlineCount) errors.push(`Za dużo nagłówków (${heads.length}/${lim.headlineCount}) dla ${platform}.`);
  heads.forEach((h, i) => { if (h.length > lim.headlineMax) errors.push(`Nagłówek ${i + 1} za długi: ${h.length}/${lim.headlineMax} znaków (${platform}).`); });
  if (descs.length > lim.descriptionCount) errors.push(`Za dużo opisów (${descs.length}/${lim.descriptionCount}) dla ${platform}.`);
  descs.forEach((d, i) => { if (d.length > lim.descriptionMax) errors.push(`Opis ${i + 1} za długi: ${d.length}/${lim.descriptionMax} znaków (${platform}).`); });
  if (lim.primaryTextMax && creative.primaryText && creative.primaryText.length > lim.primaryTextMax)
    errors.push(`Tekst główny za długi: ${creative.primaryText.length}/${lim.primaryTextMax} znaków (${platform}).`);

  return { ok: errors.length === 0, errors };
}

/** Pure: czy plan wolno wyeksportować? Tylko gdy kreacja przechodzi walidację formatu (dla reklam). */
export function canExport(plan: CampaignPlan): FormatValidation {
  if (plan.type === "paid_ad" && plan.platform) return validateAdFormat(plan.platform, plan.creative);
  return { ok: true, errors: [] };
}

/** Dozwolone przejścia cyklu życia — draft nigdy nie „przeskakuje" od razu do potwierdzonej publikacji. */
const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["approved", "failed"],
  approved: ["scheduled", "exported", "failed"],
  scheduled: ["exported", "published_confirmed", "failed"],
  exported: ["published_confirmed", "failed"],
  published_confirmed: [],
  failed: ["draft"],
};

/** Pure: zmień status z zapisem HISTORII. Niedozwolone przejście → plan bez zmian (bezpiecznie). */
export function transitionCampaign(plan: CampaignPlan, to: CampaignStatus, now: number, note?: string): CampaignPlan {
  if (!TRANSITIONS[plan.status].includes(to)) return plan;
  return { ...plan, status: to, updatedAt: now, history: [...plan.history, { at: now, from: plan.status, to, note }] };
}

/** Pure: budżet z jawnych założeń albo oznaczony jako sugestia (gdy brak danych). */
export function budgetFromAssumptions(input: { dailyClicks?: number; cpc?: number; days?: number }): CampaignBudget {
  if (typeof input.dailyClicks === "number" && typeof input.cpc === "number" && typeof input.days === "number") {
    const amount = Math.round(input.dailyClicks * input.cpc * input.days * 100) / 100;
    return { amount, currency: "PLN", isSuggestion: false, assumption: `${input.dailyClicks} klików/dzień × ${input.cpc} zł CPC × ${input.days} dni` };
  }
  return { isSuggestion: true, assumption: "Brak twardych danych — budżet to sugestia do potwierdzenia." };
}

/** Pure: utwórz nowy plan kampanii jako DRAFT (nigdy nie „opublikowany"). */
export function newCampaign(input: {
  id: string; type: CampaignType; platform?: AdPlatform; audience: string; offer: string; channel: string;
  creative: CampaignCreative; cta: string; utm: CampaignUtm; budget?: CampaignBudget; kpi?: string[];
  landingPageId?: string; variant?: string; evidence?: string[]; risks?: string[]; now: number;
}): CampaignPlan {
  return {
    id: input.id, type: input.type, platform: input.platform, audience: input.audience, offer: input.offer,
    landingPageId: input.landingPageId, channel: input.channel, creative: input.creative, cta: input.cta,
    utm: input.utm, budget: input.budget || { isSuggestion: true }, kpi: input.kpi || [], variant: input.variant,
    evidence: input.evidence || [], risks: input.risks || [], status: "draft",
    history: [], createdAt: input.now, updatedAt: input.now,
  };
}
