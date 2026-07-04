import { NextResponse } from "next/server";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { prospectingSearchSchema } from "@/lib/validations";
import { searchBusinesses } from "@/lib/prospecting";

export const dynamic = "force-dynamic";

/** Search local businesses (Google Maps / CEIDG / sample) — nothing persisted. */
export async function POST(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, prospectingSearchSchema);
  if ("res" in b) return b.res;

  try {
    const result = await searchBusinesses({
      category: b.data.category,
      city: b.data.city,
      limit: b.data.limit ?? 15,
      noWebsiteOnly: b.data.noWebsiteOnly ?? false,
    });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "prospecting.search");
  }
}
