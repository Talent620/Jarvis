import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAcquisitionTickForAllCompanies } from "@/lib/acquisition/autopilot";

export const dynamic = "force-dynamic";

/**
 * Machine-triggered autopilot heartbeat. Point any scheduler at this (Vercel
 * Cron, QStash, GitHub Actions, k8s CronJob…). Auth via a shared secret:
 *   Authorization: Bearer <CRON_SECRET>   (Vercel Cron sends this automatically)
 *   or ?secret=<CRON_SECRET>
 *
 * If CRON_SECRET is unset we allow it only outside production (dev convenience)
 * and refuse to run unauthenticated in production.
 */
function authorize(req: Request): { ok: true } | { ok: false; res: Response } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, res: NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 }) };
    }
    return { ok: true };
  }
  const url = new URL(req.url);
  const header = req.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const provided = bearer ?? url.searchParams.get("secret");
  if (provided !== secret) {
    return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true };
}

async function run(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return auth.res;
  try {
    const result = await runAcquisitionTickForAllCompanies("CRON");
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[api:cron]", e);
    return NextResponse.json({ error: "Cron run failed" }, { status: 500 });
  }
}

// Vercel Cron issues GET; allow both. Both require the secret.
export async function GET(req: Request) {
  const url = new URL(req.url);
  // `?status=1` returns a lightweight status without triggering a run.
  if (url.searchParams.get("status")) {
    const auth = authorize(req);
    if (!auth.ok) return auth.res;
    const companies = await prisma.company.count();
    const lastRun = await prisma.acquisitionRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, status: true, trigger: true },
    });
    return NextResponse.json({ ok: true, companies, lastRun });
  }
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
