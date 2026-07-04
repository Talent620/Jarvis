import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError, err } from "@/lib/api";
import { enrollSchema } from "@/lib/validations";
import { enrollLead, enrollEligibleLeads } from "@/lib/acquisition/sequences";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, enrollSchema);
  if ("res" in b) return b.res;

  try {
    const sequence = await prisma.sequence.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      select: { id: true, active: true },
    });
    if (!sequence) return err("Not found", 404);
    if (!sequence.active) return err("Sequence is not active", 409);

    if (b.data.leadId) {
      const enrollment = await enrollLead({
        companyId: a.ctx.companyId,
        leadId: b.data.leadId,
        sequenceId: params.id,
      });
      return NextResponse.json({ enrolled: enrollment ? 1 : 0, alreadyEnrolled: !enrollment });
    }

    // Default: enroll all eligible outbound leads.
    const result = await enrollEligibleLeads({
      companyId: a.ctx.companyId,
      sequenceId: params.id,
      max: b.data.max,
    });
    return NextResponse.json(result);
  } catch (e) {
    return serverError(e, "sequences.enroll");
  }
}
