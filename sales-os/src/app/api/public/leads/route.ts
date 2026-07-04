import { NextResponse } from "next/server";
import { ingestLead } from "@/lib/acquisition/ingest";
import { resolveCompanyByToken, rateLimit } from "@/lib/acquisition/token";
import { publicLeadSchema } from "@/lib/validations";

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
 * Public lead-capture endpoint. Drop this on any website form (token in the
 * `X-Ingest-Token` header or `token` field). Bots are filtered via a honeypot
 * field (`_hp`) and a per-token/IP rate limit. Captured leads flow straight
 * into the scoring + assignment + (optional) AI-draft pipeline.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Honeypot — silently accept (so bots don't retry) but ignore.
  if (typeof body._hp === "string" && body._hp.trim().length > 0) {
    return NextResponse.json({ ok: true }, { headers: CORS });
  }

  const headerToken = req.headers.get("x-ingest-token") ?? undefined;
  const token = headerToken ?? (typeof body.token === "string" ? body.token : undefined);

  const company = await resolveCompanyByToken(token);
  if (!company) {
    return NextResponse.json(
      { error: "Invalid or missing capture token" },
      { status: 401, headers: CORS },
    );
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!rateLimit(`pub:${token}:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: CORS });
  }

  const parsed = publicLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422, headers: CORS },
    );
  }

  try {
    const r = await ingestLead({
      companyId: company.companyId,
      input: { ...parsed.data, email: parsed.data.email || null },
      source: "INBOUND_FORM",
      autoDraft: company.autoDraft,
    });
    return NextResponse.json(
      { ok: true, leadId: r.leadId, deduped: r.deduped },
      { status: 201, headers: CORS },
    );
  } catch (e) {
    console.error("[public.leads]", e);
    return NextResponse.json({ error: "Could not process lead" }, { status: 500, headers: CORS });
  }
}
