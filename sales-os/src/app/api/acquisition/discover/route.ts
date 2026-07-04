import { NextResponse } from "next/server";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { discoverSchema } from "@/lib/validations";
import { discoverLeads } from "@/lib/acquisition/discover";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, discoverSchema);
  if ("res" in b) return b.res;

  try {
    const result = await discoverLeads({
      companyId: a.ctx.companyId,
      audienceId: b.data.audienceId,
      limit: b.data.limit,
    });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "acquisition.discover");
  }
}
