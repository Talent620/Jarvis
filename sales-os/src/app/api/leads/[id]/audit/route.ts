import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth, serverError } from "@/lib/api";
import { auditLead } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // PageSpeed can take ~30s

/** Run a website audit for this lead now. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const lead = await prisma.lead.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      select: { id: true, website: true },
    });
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!lead.website) {
      return NextResponse.json({ error: "Lead has no website to audit" }, { status: 422 });
    }

    const audit = await auditLead({ companyId: a.ctx.companyId, leadId: lead.id });
    return NextResponse.json(audit, { status: 201 });
  } catch (err) {
    return serverError(err, "audit.POST");
  }
}
