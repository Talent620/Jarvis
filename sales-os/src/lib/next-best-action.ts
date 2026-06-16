import { LeadOutcome, type Lead, type FunnelStage } from "@prisma/client";

export type NextActionType =
  | "FIRST_TOUCH"
  | "FOLLOW_UP"
  | "QUALIFY"
  | "SEND_PROPOSAL"
  | "CLOSE"
  | "RE_ENGAGE"
  | "NURTURE";

export interface NextAction {
  type: NextActionType;
  label: string;
  rationale: string;
  urgency: "high" | "medium" | "low";
  /** Suggested AI content kind to draft, if any. */
  draftKind?: "EMAIL" | "FOLLOW_UP" | "OFFER" | "DM";
}

type LeadLike = Lead & { stage?: Pick<FunnelStage, "name" | "isWon" | "isLost"> | null };

const DAY = 86_400_000;

/**
 * Heuristic "next best action" recommender. Pure + deterministic so it can run
 * on the server (lists, dashboard) and be unit-tested. The AI Copilot can layer
 * richer reasoning on top, but this guarantees a sensible default everywhere.
 */
export function nextBestAction(lead: LeadLike): NextAction {
  const now = Date.now();
  const stage = lead.stage?.name?.toLowerCase() ?? "";
  const daysSinceContact = lead.lastContactedAt
    ? (now - new Date(lead.lastContactedAt).getTime()) / DAY
    : Infinity;

  if (lead.outcome === LeadOutcome.WON || lead.stage?.isWon) {
    return {
      type: "NURTURE",
      label: "Ask for a referral / upsell",
      rationale: "Closed-won — best moment to request a referral or introduce a higher tier.",
      urgency: "low",
      draftKind: "EMAIL",
    };
  }

  if (lead.outcome === LeadOutcome.LOST || lead.stage?.isLost) {
    return {
      type: "RE_ENGAGE",
      label: "Schedule a re-engagement in 60 days",
      rationale: "Lost deal — park it and re-engage later with a new angle.",
      urgency: "low",
    };
  }

  if (!lead.lastContactedAt) {
    return {
      type: "FIRST_TOUCH",
      label: "Send first outreach",
      rationale: "No contact recorded yet. Open the conversation while the lead is fresh.",
      urgency: lead.score >= 60 ? "high" : "medium",
      draftKind: "EMAIL",
    };
  }

  if (stage.includes("proposal") || stage.includes("negotiation")) {
    return {
      type: "CLOSE",
      label: "Follow up to close",
      rationale: "Late-stage deal — drive to a decision before momentum fades.",
      urgency: "high",
      draftKind: "FOLLOW_UP",
    };
  }

  if (stage.includes("qualified")) {
    return {
      type: "SEND_PROPOSAL",
      label: "Send a tailored offer",
      rationale: "Lead is qualified — convert interest into a concrete proposal.",
      urgency: "high",
      draftKind: "OFFER",
    };
  }

  if (stage.includes("contacted") && daysSinceContact >= 3) {
    return {
      type: "FOLLOW_UP",
      label: "Follow up",
      rationale: `No reply in ${Math.floor(daysSinceContact)} days. A nudge here lifts reply rates.`,
      urgency: daysSinceContact >= 7 ? "high" : "medium",
      draftKind: "FOLLOW_UP",
    };
  }

  if (stage.includes("new") || daysSinceContact < 3) {
    return {
      type: "QUALIFY",
      label: "Qualify the lead",
      rationale: "Confirm fit, budget and timing before investing more effort.",
      urgency: "medium",
      draftKind: "DM",
    };
  }

  if (daysSinceContact >= 14) {
    return {
      type: "RE_ENGAGE",
      label: "Re-engage",
      rationale: `Quiet for ${Math.floor(daysSinceContact)} days — revive with fresh value.`,
      urgency: "medium",
      draftKind: "FOLLOW_UP",
    };
  }

  return {
    type: "NURTURE",
    label: "Keep nurturing",
    rationale: "On track — stay top of mind with relevant touches.",
    urgency: "low",
    draftKind: "FOLLOW_UP",
  };
}
