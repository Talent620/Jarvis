import type { Priority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recomputeLeadScore } from "@/lib/lead-service";
import { logActivity } from "@/lib/activity";
import type { ProspectCandidate } from "./providers/types";
import type { NormalizedLeadInput } from "./ingest";

const SENIOR_HINTS = ["owner", "founder", "ceo", "managing", "director", "vp", "head", "chief"];

/** Best-effort website from an email domain (skips free/consumer providers). */
const FREE_EMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com",
  "wp.pl", "o2.pl", "interia.pl", "onet.pl", "icloud.com", "proton.me",
]);

export function websiteFromEmail(email?: string | null): string | null {
  if (!email) return null;
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain || FREE_EMAIL.has(domain)) return null;
  return `https://${domain}`;
}

/** Coarse deal-value estimate from a company-size band — feeds scoring. */
function valueFromSize(size?: string | null): number | null {
  if (!size) return null;
  const max = Math.max(...(size.match(/\d+/g) ?? ["0"]).map(Number));
  if (max >= 1000) return 50_000;
  if (max >= 500) return 40_000;
  if (max >= 200) return 25_000;
  if (max >= 50) return 15_000;
  if (max > 0) return 8_000;
  return null;
}

function priorityFor(intentScore: number, position?: string | null): Priority {
  const senior = SENIOR_HINTS.some((h) => (position ?? "").toLowerCase().includes(h));
  const score = intentScore + (senior ? 15 : 0);
  if (score >= 80) return "URGENT";
  if (score >= 60) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

export interface CandidateEnrichment {
  input: NormalizedLeadInput;
  priority: Priority;
  tags: string[];
  draftContext: string;
  intentScore: number;
}

/**
 * Turn a raw provider candidate into an enriched, ingest-ready lead: derive a
 * website, estimate deal value from size, set a priority from intent + role,
 * attach intent tags, and assemble a context line the first-touch draft can
 * personalise around. Pure — no I/O.
 */
export function enrichCandidate(c: ProspectCandidate): CandidateEnrichment {
  const intentScore = c.intentScore ?? 0;
  const website = c.website ?? websiteFromEmail(c.email);
  const estimatedValue = valueFromSize(c.companySize);

  const tags = ["outbound"];
  if (intentScore >= 70) tags.push("high-intent");
  else if (intentScore >= 40) tags.push("warm-intent");
  if (c.companySize) tags.push(`size:${c.companySize}`);

  const contextParts = [
    c.position && c.companyName ? `${c.position} at ${c.companyName}` : c.companyName ?? "",
    c.companySize ? `company size ${c.companySize}` : "",
    c.industry ? `industry ${c.industry}` : "",
    c.region ? `region ${c.region}` : "",
    c.signals?.length ? `buying signals: ${c.signals.join(", ")}` : "",
    c.source ? `best channel ${c.source.toLowerCase().replace("_", " ")}` : "",
  ].filter(Boolean);

  return {
    input: {
      name: c.name,
      email: c.email,
      phone: c.phone ?? null,
      companyName: c.companyName,
      position: c.position,
      website,
      industry: c.industry,
      region: c.region,
      estimatedValue,
      sourceDetail: c.sourceDetail,
    },
    priority: priorityFor(intentScore, c.position),
    tags,
    draftContext: contextParts.join(" · "),
    intentScore,
  };
}

/**
 * Post-ingest heuristic enrichment for an existing lead (e.g. inbound leads
 * that arrived with sparse data). Fills a derivable website, then rescopes the
 * score and writes a timeline entry. Returns true when anything changed.
 */
export async function enrichLeadById(companyId: string, leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId, deletedAt: null },
  });
  if (!lead) return false;

  const patch: Record<string, unknown> = {};
  const changes: string[] = [];

  if (!lead.website) {
    const w = websiteFromEmail(lead.email);
    if (w) {
      patch.website = w;
      changes.push("website");
    }
  }

  if (Object.keys(patch).length === 0) return false;

  const updated = await prisma.lead.update({ where: { id: lead.id }, data: patch });
  await recomputeLeadScore(updated);
  await logActivity({
    companyId,
    leadId: lead.id,
    type: "SYSTEM",
    title: `Enriched: ${changes.join(", ")}`,
  });
  return true;
}
