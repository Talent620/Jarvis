import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCompanyByToken, rateLimit } from "@/lib/acquisition/token";
import { applyJarvisStatus, JARVIS_STATUSES, type JarvisStatus } from "@/lib/acquisition/public-status";

export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Ingest-Token",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Public lead-status endpoint (JARVIS → CRM half of two-way status sync).
 * Identify the lead by `leadId` (the CRM id JARVIS keeps from /sync) or by
 * `email`/`phone`, then move it to the funnel stage matching the JARVIS status.
 * Auth: the same X-Ingest-Token.
 *
 * POST { leadId? | email? | phone?, status: "new"|"contacted"|"offer"|"won"|"lost" }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const headerToken = req.headers.get("x-ingest-token") ?? undefined;
  const token = headerToken ?? (typeof body.token === "string" ? body.token : undefined);
  const company = await resolveCompanyByToken(token);
  if (!company) {
    return NextResponse.json({ error: "Invalid or missing capture token" }, { status: 401, headers: CORS });
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!rateLimit(`status:${token}:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: CORS });
  }

  const status = typeof body.status === "string" ? (body.status.toLowerCase() as JarvisStatus) : undefined;
  if (!status || !JARVIS_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `\`status\` must be one of: ${JARVIS_STATUSES.join(", ")}` },
      { status: 422, headers: CORS },
    );
  }

  try {
    // Resolve the lead: explicit CRM id wins, else email/phone within the workspace.
    let leadId = typeof body.leadId === "string" ? body.leadId : null;
    if (leadId) {
      const exists = await prisma.lead.findFirst({
        where: { id: leadId, companyId: company.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) leadId = null;
    }
    if (!leadId) {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      if (!email && !phone) {
        return NextResponse.json({ error: "Provide leadId, email or phone to identify the lead" }, { status: 422, headers: CORS });
      }
      const found = await prisma.lead.findFirst({
        where: {
          companyId: company.companyId,
          deletedAt: null,
          OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
        },
        select: { id: true },
      });
      if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404, headers: CORS });
      leadId = found.id;
    }

    const result = await applyJarvisStatus({ companyId: company.companyId, leadId, status });
    return NextResponse.json({ ok: true, ...result }, { headers: CORS });
  } catch (e) {
    console.error("[public.lead-status]", e);
    return NextResponse.json({ error: "Could not update status" }, { status: 500, headers: CORS });
  }
}
