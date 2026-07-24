import { NextResponse } from "next/server";
import type { LeadSource } from "@prisma/client";
import { ingestLead } from "@/lib/acquisition/ingest";
import { normalizeWebhook } from "@/lib/acquisition/normalize";
import { resolveCompanyByToken, rateLimit } from "@/lib/acquisition/token";

export const dynamic = "force-dynamic";

/**
 * Meta (Facebook/Instagram) Lead Ads webhook verification handshake — echoes
 * `hub.challenge` so the subscription can be verified.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const challenge = url.searchParams.get("hub.challenge");
  if (challenge) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: true });
}

function sourceFor(provider: string): LeadSource {
  if (["meta", "facebook", "instagram", "google", "ads"].includes(provider)) return "ADS";
  if (provider === "linkedin") return "LINKEDIN";
  return "INBOUND_FORM";
}

/**
 * Receives lead webhooks from any provider (path segment = provider name) and
 * normalizes them into the shared ingest pipeline. Token via `?token=` or the
 * `X-Ingest-Token` header.
 */
export async function POST(req: Request, props: { params: Promise<{ provider: string }> }) {
  const params = await props.params;
  const url = new URL(req.url);
  const token =
    req.headers.get("x-ingest-token") ?? url.searchParams.get("token") ?? undefined;

  const company = await resolveCompanyByToken(token);
  if (!company) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  if (!rateLimit(`wh:${token}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const provider = params.provider.toLowerCase();
  const input = normalizeWebhook(provider, body);

  if (!input.name && !input.email && !input.phone) {
    return NextResponse.json({ ok: false, reason: "no contact fields" }, { status: 202 });
  }

  try {
    const r = await ingestLead({
      companyId: company.companyId,
      input,
      source: sourceFor(provider),
      sourceDetail: input.sourceDetail,
      autoDraft: company.autoDraft,
    });
    return NextResponse.json({ ok: true, leadId: r.leadId, deduped: r.deduped });
  } catch (e) {
    console.error("[webhooks]", e);
    return NextResponse.json({ error: "Could not process" }, { status: 500 });
  }
}
