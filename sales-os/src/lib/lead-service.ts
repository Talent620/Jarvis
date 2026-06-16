import type { Lead } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scoreLead, type ScoreResult } from "@/lib/scoring";

/**
 * Re-run the deterministic scoring engine for a lead, persist the denormalized
 * score/grade onto the Lead, and append a LeadScore history row. Returns the
 * full ScoreResult ({ score, grade, breakdown, reason }) so callers can surface
 * the explanation. Accepts the already-loaded Lead to avoid a redundant read.
 */
export async function recomputeLeadScore(lead: Lead): Promise<ScoreResult> {
  const result = scoreLead(lead);

  await prisma.$transaction([
    prisma.lead.update({
      where: { id: lead.id },
      data: { score: result.score, scoreGrade: result.grade },
    }),
    prisma.leadScore.create({
      data: {
        companyId: lead.companyId,
        leadId: lead.id,
        score: result.score,
        grade: result.grade,
        breakdown: result.breakdown,
        reason: result.reason,
      },
    }),
  ]);

  return result;
}
