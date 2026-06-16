import {
  LeadOutcome,
  LeadSource,
  Priority,
  ScoreGrade,
  type Lead,
} from "@prisma/client";
import { SCORE_GRADE_META } from "@/lib/constants";

export type ScoreBreakdown = Record<string, number>;

export interface ScoreResult {
  score: number; // 0..100
  grade: ScoreGrade;
  breakdown: ScoreBreakdown;
  reason: string;
}

const SOURCE_POINTS: Record<LeadSource, number> = {
  REFERRAL: 22,
  INBOUND_FORM: 20,
  WEBSITE: 16,
  EVENT: 16,
  LINKEDIN: 12,
  MARKETPLACE: 10,
  ADS: 10,
  FACEBOOK_GROUP: 8,
  GOOGLE_MAPS: 14,        // verified local business with a real need (no/weak site)
  BUSINESS_REGISTRY: 12,  // freshly registered company — needs everything
  COLD_OUTREACH: 6,
  OTHER: 4,
};

const PRIORITY_POINTS: Record<Priority, number> = {
  URGENT: 18,
  HIGH: 13,
  MEDIUM: 7,
  LOW: 2,
};

function gradeFromScore(score: number): ScoreGrade {
  if (score >= SCORE_GRADE_META.A.min) return "A";
  if (score >= SCORE_GRADE_META.B.min) return "B";
  if (score >= SCORE_GRADE_META.C.min) return "C";
  return "D";
}

/**
 * Deterministic, explainable rule-based lead scoring (0..100).
 * Transparent on purpose: every point is attributable to a factor, which is
 * what gets persisted in LeadScore.breakdown and shown in the UI.
 */
export function scoreLead(
  lead: Pick<
    Lead,
    | "source"
    | "priority"
    | "outcome"
    | "budget"
    | "estimatedValue"
    | "email"
    | "phone"
    | "companyName"
    | "industry"
    | "lastContactedAt"
    | "expectedCloseAt"
    | "createdAt"
  >,
): ScoreResult {
  const b: ScoreBreakdown = {};

  // Acquisition channel quality
  b["Source"] = SOURCE_POINTS[lead.source] ?? 4;

  // Declared urgency
  b["Priority"] = PRIORITY_POINTS[lead.priority] ?? 7;

  // Budget signal
  const budget = lead.budget ?? 0;
  b["Budget"] = budget >= 50000 ? 18 : budget >= 20000 ? 13 : budget >= 5000 ? 8 : budget > 0 ? 4 : 0;

  // Deal value potential
  const value = lead.estimatedValue ?? 0;
  b["Deal value"] = value >= 50000 ? 12 : value >= 15000 ? 8 : value > 0 ? 4 : 0;

  // Data completeness (reachability)
  let completeness = 0;
  if (lead.email) completeness += 5;
  if (lead.phone) completeness += 4;
  if (lead.companyName) completeness += 3;
  if (lead.industry) completeness += 2;
  b["Profile completeness"] = completeness;

  // Recency of engagement
  const now = Date.now();
  if (lead.lastContactedAt) {
    const days = (now - new Date(lead.lastContactedAt).getTime()) / 86_400_000;
    b["Recent engagement"] = days <= 3 ? 12 : days <= 7 ? 8 : days <= 21 ? 4 : 0;
  } else {
    b["Recent engagement"] = 0;
  }

  // Close timeline
  if (lead.expectedCloseAt) {
    const days = (new Date(lead.expectedCloseAt).getTime() - now) / 86_400_000;
    b["Close timeline"] = days <= 14 ? 8 : days <= 45 ? 5 : 2;
  } else {
    b["Close timeline"] = 0;
  }

  // Staleness penalty for untouched, never-contacted leads
  const ageDays = (now - new Date(lead.createdAt).getTime()) / 86_400_000;
  if (!lead.lastContactedAt && ageDays > 14) {
    b["Stale (no contact)"] = -10;
  }

  // Outcome overrides
  if (lead.outcome === LeadOutcome.WON) b["Won"] = 100;
  if (lead.outcome === LeadOutcome.LOST) b["Lost"] = -100;

  let raw = Object.values(b).reduce((s, n) => s + n, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const grade = gradeFromScore(score);

  const top = Object.entries(b)
    .filter(([, v]) => v > 0)
    .sort((a, c) => c[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  const reason =
    lead.outcome === LeadOutcome.WON
      ? "Closed-won."
      : lead.outcome === LeadOutcome.LOST
        ? "Closed-lost."
        : top.length
          ? `Driven by ${top.join(", ").toLowerCase()}.`
          : "Limited signal — enrich this lead to improve scoring.";

  return { score, grade, breakdown: b, reason };
}
