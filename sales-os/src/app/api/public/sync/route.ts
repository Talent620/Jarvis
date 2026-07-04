import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCompanyByToken, rateLimit } from "@/lib/acquisition/token";

export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Ingest-Token",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Read-only sync endpoint for a companion app (e.g. JARVIS).
 *
 * Uses the SAME capture token as the public inbound endpoint (in the
 * `X-Ingest-Token` header or `?token=` query). It exposes a read-only snapshot
 * of the workspace — leads + a small metrics summary — so an external assistant
 * can have *visibility* into the pipeline without touching the database or
 * sharing a login. The two tools stay separate but stay in sync.
 *
 * GET /api/public/sync?limit=200
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const headerToken = req.headers.get("x-ingest-token") ?? undefined;
  const token = headerToken ?? url.searchParams.get("token") ?? undefined;

  const company = await resolveCompanyByToken(token);
  if (!company) {
    return NextResponse.json(
      { error: "Invalid or missing capture token" },
      { status: 401, headers: CORS },
    );
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!rateLimit(`sync:${token}:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: CORS });
  }

  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));

  try {
    const [companyRow, leads, outcomeGroups, valueAgg] = await Promise.all([
      prisma.company.findUnique({
        where: { id: company.companyId },
        select: { id: true, name: true },
      }),
      prisma.lead.findMany({
        where: { companyId: company.companyId, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          companyName: true,
          website: true,
          industry: true,
          region: true,
          source: true,
          priority: true,
          outcome: true,
          estimatedValue: true,
          score: true,
          scoreGrade: true,
          hasWebsite: true,
          lastContactedAt: true,
          nextActionAt: true,
          nextActionNote: true,
          stage: { select: { name: true } },
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.lead.groupBy({
        by: ["outcome"],
        where: { companyId: company.companyId, deletedAt: null },
        _count: { _all: true },
      }),
      prisma.lead.aggregate({
        where: { companyId: company.companyId, deletedAt: null, outcome: "WON" },
        _sum: { estimatedValue: true },
      }),
    ]);

    const byOutcome: Record<string, number> = {};
    let total = 0;
    for (const g of outcomeGroups) {
      byOutcome[g.outcome] = g._count._all;
      total += g._count._all;
    }

    return NextResponse.json(
      {
        company: companyRow ?? { id: company.companyId, name: null },
        metrics: {
          totalLeads: total,
          byOutcome,
          wonValue: valueAgg._sum.estimatedValue ?? 0,
        },
        leads: leads.map((l) => ({
          ...l,
          stage: l.stage?.name ?? null,
        })),
        syncedAt: new Date().toISOString(),
      },
      { headers: CORS },
    );
  } catch (e) {
    console.error("[public.sync]", e);
    return NextResponse.json({ error: "Could not load sync snapshot" }, { status: 500, headers: CORS });
  }
}
