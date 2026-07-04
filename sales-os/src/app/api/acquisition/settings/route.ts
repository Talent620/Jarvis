import { NextResponse } from "next/server";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { acquisitionSettingsSchema } from "@/lib/validations";
import { ensureAcquisitionSettings, updateAcquisitionSettings } from "@/lib/acquisition/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await getAuth();
  if ("res" in a) return a.res;
  try {
    const settings = await ensureAcquisitionSettings(a.ctx.companyId);
    return NextResponse.json(settings);
  } catch (err) {
    return serverError(err, "acquisition.settings.GET");
  }
}

export async function PATCH(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, acquisitionSettingsSchema);
  if ("res" in b) return b.res;

  try {
    const settings = await updateAcquisitionSettings(a.ctx.companyId, b.data);
    return NextResponse.json(settings);
  } catch (err) {
    return serverError(err, "acquisition.settings.PATCH");
  }
}
