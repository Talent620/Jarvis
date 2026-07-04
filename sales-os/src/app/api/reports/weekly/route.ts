import { NextResponse } from "next/server";
import { getAuth, serverError } from "@/lib/api";
import { generateWeeklyReport, detectHotLeads, performanceAlerts } from "@/jobs";

export const dynamic = "force-dynamic";

/**
 * Trigger the weekly report on demand. Also runs detection + alert jobs so the
 * "generate report" button doubles as a full refresh of system-generated
 * notifications — handy in a demo and as a manual fallback for the scheduler.
 */
export async function POST() {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    await detectHotLeads({ companyId: a.ctx.companyId });
    await performanceAlerts({ companyId: a.ctx.companyId });
    const report = await generateWeeklyReport({ companyId: a.ctx.companyId });
    return NextResponse.json(report, { status: 201 });
  } catch (err) {
    return serverError(err, "reports.weekly");
  }
}
