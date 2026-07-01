// === Reklama → strukturalna kampania (adCampaign) ===
// Glue nad campaignEngine: bierze surowy tekst z generatora reklam i robi z niego PRAWDZIWY
// CampaignPlan (nie luźny tekst zapisany jako „post"). Parser jest deterministyczny i testowalny,
// mapuje platformę UI na format reklamowy, buduje wspólne ID (campaignId ↔ utm.campaign), a kreacja
// jest walidowana formatem PRZED eksportem. Reklama płatna to typ paid_ad — inny niż post organiczny.
// Nie jest osobnym silnikiem — komponuje istniejący campaignEngine. S9-safe (bez /u, \p, lookbehind).

import { newCampaign, type AdPlatform, type CampaignCreative, type CampaignPlan, type CampaignUtm } from "./campaignEngine";
import type { AdPlatform as UiAdPlatform } from "./adStudio";

/** Pure: mapuj platformę UI (google/meta) na format reklamowy campaignEngine. */
export function mapAdPlatform(p: UiAdPlatform): AdPlatform {
  return p === "google" ? "google_rsa" : "meta";
}

/** Pure: slug kampanii do utm.campaign (wspólne ID). Bez /u — jawne polskie znaki. */
export function slugifyCampaign(name: string): string {
  const s = (name || "").trim().toLowerCase();
  if (!s) return "";
  return s
    .replace(/[ąàâä]/g, "a").replace(/[ćç]/g, "c").replace(/[ęèéê]/g, "e").replace(/ł/g, "l")
    .replace(/[ńñ]/g, "n").replace(/[óòô]/g, "o").replace(/ś/g, "s").replace(/[źż]/g, "z")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// Usuń adnotacje typu „(maks. 30 znaków)", numerację i cudzysłowy z pozycji listy.
function cleanItem(line: string): string {
  let t = line.trim();
  t = t.replace(/^[0-9]+[.)]\s*/, "").replace(/^[-*•]\s*/, "");
  t = t.replace(/\s*\((?:maks\.?|max\.?)[^)]*\)\s*$/i, "");
  t = t.replace(/\s*[—-]\s*[0-9]+\s*\/\s*[0-9]+\s*znak[oó]w.*$/i, "");
  t = t.replace(/^["'„]+/, "").replace(/["'"]+$/, "");
  return t.trim();
}

const isHeader = (line: string): boolean => /^\s*(?:[0-9]+[.)]\s*)?[A-ZŁŚŻŹĆĄĘÓŃ][A-ZŁŚŻŹĆĄĘÓŃ \t]{2,}:/.test(line);
const matches = (line: string, re: RegExp): boolean => re.test(line);

/**
 * Pure: wyłuskaj kreację (nagłówki/opisy/tekst główny) z surowego tekstu reklamy. Sekcje rozpoznajemy
 * po nagłówkach (NAGŁÓWKI/OPISY/TEKST GŁÓWNY). Odporny na numerację, myślniki i adnotacje znaków.
 */
export function parseAdCreative(text: string): CampaignCreative {
  const lines = (text || "").split(/\r?\n/);
  const headlines: string[] = [];
  const descriptions: string[] = [];
  const primaryParts: string[] = [];
  type Bucket = "headline" | "description" | "primary" | null;
  let bucket: Bucket = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeader(line)) {
      if (matches(line, /NAG[ŁL]/i)) bucket = "headline";
      else if (matches(line, /OPIS/i)) bucket = "description";
      else if (matches(line, /TEKST\s*G[ŁL]/i)) bucket = "primary";
      else bucket = null; // słowa kluczowe, budżet, kreacje itp. — pomijamy
      // treść może stać po dwukropku w tej samej linii
      const after = line.slice(line.indexOf(":") + 1).trim();
      if (after && bucket) {
        const v = cleanItem(after);
        if (v) (bucket === "headline" ? headlines : bucket === "description" ? descriptions : primaryParts).push(v);
      }
      continue;
    }
    if (!bucket) continue;
    const v = cleanItem(line);
    if (!v) continue;
    if (bucket === "headline") headlines.push(v);
    else if (bucket === "description") descriptions.push(v);
    else primaryParts.push(v);
  }

  const creative: CampaignCreative = { headlines, descriptions };
  if (primaryParts.length) creative.primaryText = primaryParts[0];
  return creative;
}

/**
 * Pure: zbuduj CampaignPlan (DRAFT) z surowej reklamy. campaignId = utm.campaign (wspólne ID w linkach).
 * Reklama płatna (paid_ad) — landing/lead/oferta/płatność dzielą to samo campaignId w pętli ROI.
 */
export function buildAdCampaign(input: {
  id: string;
  uiPlatform: UiAdPlatform;
  product: string;
  audience?: string;
  goal?: string;
  rawText: string;
  cta?: string;
  landingPageId?: string;
  now: number;
}): CampaignPlan {
  const platform = mapAdPlatform(input.uiPlatform);
  const creative = parseAdCreative(input.rawText);
  const slug = slugifyCampaign(input.product) || `kampania-${input.id.slice(0, 6)}`;
  const utm: CampaignUtm = { source: input.uiPlatform === "google" ? "google" : "facebook", medium: "cpc", campaign: slug };
  return newCampaign({
    id: input.id,
    type: "paid_ad",
    platform,
    audience: (input.audience || "").trim() || "nieokreślona",
    offer: input.product.trim(),
    channel: input.uiPlatform === "google" ? "Google Ads" : "Meta Ads",
    creative,
    cta: input.cta || "Dowiedz się więcej",
    utm,
    landingPageId: input.landingPageId,
    kpi: input.goal ? [input.goal] : [],
    evidence: [`Wygenerowano ${creative.headlines.length} nagłówków, ${creative.descriptions.length} opisów.`],
    now: input.now,
  });
}

/**
 * Pure: zbuduj CampaignPlan typu organic_post (post w social). To INNA operacja niż reklama płatna —
 * organic nie ma formatu Ads i nie wymaga Ads API. Wspólne ID (utm.campaign) łączy go z pętlą ROI.
 */
export function buildOrganicCampaign(input: { id: string; channel: string; topic: string; text: string; now: number }): CampaignPlan {
  const slug = slugifyCampaign(input.topic) || `post-${input.id.slice(0, 6)}`;
  const utm: CampaignUtm = { source: slugifyCampaign(input.channel) || "social", medium: "social", campaign: slug };
  return newCampaign({
    id: input.id,
    type: "organic_post",
    audience: "obserwujący",
    offer: input.topic.trim(),
    channel: input.channel,
    creative: { headlines: [], descriptions: [], primaryText: (input.text || "").slice(0, 600) },
    cta: "Napisz do nas",
    utm,
    now: input.now,
  });
}
