import { NextResponse } from "next/server";
import { getAuth, serverError, err } from "@/lib/api";
import { JOBS } from "@/jobs";
import { runJobs } from "@/jobs/runner";

export const dynamic = "force-dynamic";

/**
 * Run a single registered background job for the current workspace, by name.
 * Valid names: discover-leads, enrich-leads, advance-sequences, detect-hot-leads,
 * performance-alerts, weekly-report.
 */
export async function POST(_req: Request, { params }: { params: { name: string } }) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const handler = JOBS[params.name];
  if (!handler) {
    return err(`Unknown job '${params.name}'`, 404, { available: Object.keys(JOBS) });
  }

  try {
    const [result] = await runJobs({ [params.name]: handler }, { companyId: a.ctx.companyId });
    return NextResponse.json(result);
  } catch (e) {
    return serverError(e, `jobs.${params.name}`);
  }
}
