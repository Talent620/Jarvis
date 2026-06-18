import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCompanyByToken, rateLimit } from "@/lib/acquisition/token";
import { ingestLead } from "@/lib/acquisition/ingest";
import { draftAndSendForLead } from "@/lib/acquisition/public-outreach";
import { autoSendPendingEmails, emailsSentToday } from "@/lib/email/outreach";
import { ensureAcquisitionSettings } from "@/lib/acquisition/settings";

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
 * Public outreach endpoint for a companion app (JARVIS).
 *
 * Lets an external assistant have AI draft an outreach email *in this CRM* and
 * (by default) send it — keeping Sales OS the source of truth for content,
 * scoring, the approval trail and delivery. Auth: the same X-Ingest-Token.
 *
 * Two modes:
 *  1) Per-lead — `{ email, name?, companyName?, ..., context?, send? }`:
 *     resolve/create the lead, AI-draft a first-touch email into the approval
 *     queue, then send it (unless `send:false`). Reuses a pending draft if one
 *     already exists for the lead.
 *  2) Flush — `{ flushPending: true, max? }`: auto-send queued AI email drafts
 *     up to the workspace's daily email cap.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const headerToken = req.headers.get("x-ingest-token") ?? undefined;
  const token = headerToken ?? (typeof body.token === "string" ? body.token : undefined);
  const company = await resolveCompanyByToken(token);
  if (!company) {
    return NextResponse.json({ error: "Invalid or missing capture token" }, { status: 401, headers: CORS });
  }

  // Klucz na sam token — X-Forwarded-For jest kontrolowany przez klienta (rotacja omijała limit).
  // Token to twarda granica wysyłki na minutę, niezależnie od deklarowanego IP.
  if (!rateLimit(`outreach:${token}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: CORS });
  }

  try {
    // --- Mode 2: flush the pending queue ---
    if (body.flushPending === true) {
      const settings = await ensureAcquisitionSettings(company.companyId);
      const max = typeof body.max === "number" ? Math.min(50, Math.max(1, body.max)) : undefined;
      const summary = await autoSendPendingEmails({
        companyId: company.companyId,
        dailyEmailCap: settings.dailyEmailCap,
        max,
      });
      return NextResponse.json({ ok: true, mode: "flush", ...summary }, { headers: CORS });
    }

    // --- Mode 1: per-lead draft + send ---
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const send = body.send !== false; // default: send
    if (send && !email) {
      return NextResponse.json(
        { error: "An email address is required to send. Pass `email`, or use `send:false` to only draft." },
        { status: 422, headers: CORS },
      );
    }

    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() || null : null);

    // Resolve existing lead by email/phone, or create one (no auto-draft — we draft explicitly).
    const phone = str("phone");
    let leadId: string | null = null;
    if (email || phone) {
      const existing = await prisma.lead.findFirst({
        where: {
          companyId: company.companyId,
          deletedAt: null,
          OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
        },
        select: { id: true },
      });
      leadId = existing?.id ?? null;
    }

    if (!leadId) {
      const r = await ingestLead({
        companyId: company.companyId,
        input: {
          name: str("name"),
          email: email || null,
          phone,
          companyName: str("companyName"),
          website: str("website"),
          industry: str("industry"),
          region: str("region"),
        },
        source: "COLD_OUTREACH",
        sourceDetail: "JARVIS",
        autoDraft: false,
        silent: true,
      });
      leadId = r.leadId;
    }

    // Bezpieczeństwo: realna wysyłka tylko gdy właściciel włączył auto-send i nie przekroczono
    // dziennego limitu. Inaczej szkic ląduje w kolejce akceptacji (zgodnie z modelem CRM-u).
    let effectiveSend = send;
    let gated: string | undefined;
    if (send) {
      const settings = await ensureAcquisitionSettings(company.companyId);
      if (!settings.autoSendEmails) {
        effectiveSend = false;
        gated = "auto-send disabled — drafted to approval queue";
      } else if ((await emailsSentToday(company.companyId)) >= settings.dailyEmailCap) {
        effectiveSend = false;
        gated = "daily email cap reached — drafted to approval queue";
      }
    }

    const result = await draftAndSendForLead({
      companyId: company.companyId,
      leadId,
      send: effectiveSend,
      context: str("context"),
    });

    return NextResponse.json({ ok: true, mode: "lead", ...result, ...(gated ? { gated } : {}) }, { status: 201, headers: CORS });
  } catch (e) {
    console.error("[public.outreach]", e);
    return NextResponse.json({ error: "Could not process outreach" }, { status: 500, headers: CORS });
  }
}
