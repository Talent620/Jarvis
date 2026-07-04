import { NextResponse } from "next/server";
import { getAuth, serverError } from "@/lib/api";
import { runAcquisitionTick } from "@/lib/acquisition/autopilot";

export const dynamic = "force-dynamic";

/** Run the autopilot once, now, for the current workspace (ignores cadence/quiet hours). */
export async function POST() {
  const a = await getAuth();
  if ("res" in a) return a.res;
  try {
    const result = await runAcquisitionTick({ companyId: a.ctx.companyId, trigger: "MANUAL" });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "acquisition.run.POST");
  }
}
