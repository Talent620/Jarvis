import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { sendEmail, type SendEmailResult } from "./index";

function subjectFor(body: string, companyName: string | null, leadCompany: string | null): string {
  // First non-empty line often is the hook; otherwise a sane default.
  const firstLine = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (firstLine.length >= 8 && firstLine.length <= 80 && !firstLine.endsWith(",")) {
    return firstLine.replace(/^(hi|hello|dear|hey|cześć|dzień dobry)[^a-z0-9]*/i, "").trim() || firstLine;
  }
  return leadCompany
    ? `Quick idea for ${leadCompany}`
    : `Quick idea from ${companyName ?? "us"}`;
}

export interface SendDraftResult extends SendEmailResult {
  skipped?: string;
}

/**
 * Deliver one approved outreach draft (CampaignMessage) to its lead by email,
 * then mark it sent, stamp the lead's lastContactedAt, log the timeline entry,
 * bump campaign counters and the daily `emails.sent` metric.
 */
export async function sendDraftToLead(args: {
  companyId: string;
  campaignMessageId: string;
  userId?: string | null;
  auto?: boolean;
}): Promise<SendDraftResult> {
  const msg = await prisma.campaignMessage.findFirst({
    where: { id: args.campaignMessageId, companyId: args.companyId },
    include: {
      lead: { select: { id: true, name: true, email: true, companyName: true } },
      campaign: { select: { id: true } },
    },
  });
  if (!msg) return { ok: false, provider: "simulated", simulated: true, skipped: "message not found" };
  if (msg.sentAt) return { ok: true, provider: "simulated", simulated: true, skipped: "already sent" };
  if (!msg.lead?.email) {
    return { ok: false, provider: "simulated", simulated: true, skipped: "lead has no email" };
  }

  const company = await prisma.company.findUnique({
    where: { id: args.companyId },
    select: { name: true },
  });

  const subject = msg.subject ?? subjectFor(msg.body, company?.name ?? null, msg.lead.companyName);
  const result = await sendEmail({ to: msg.lead.email, subject, text: msg.body });

  if (!result.ok) {
    await logActivity({
      companyId: args.companyId,
      leadId: msg.lead.id,
      userId: args.userId ?? null,
      type: "SYSTEM",
      title: "Email delivery failed",
      body: result.error ?? null,
    });
    return result;
  }

  const now = new Date();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  await Promise.all([
    prisma.campaignMessage.update({
      where: { id: msg.id },
      data: { sentAt: now, approved: true },
    }),
    prisma.lead.update({
      where: { id: msg.lead.id },
      data: { lastContactedAt: now },
    }),
    msg.campaign
      ? prisma.campaign.update({
          where: { id: msg.campaign.id },
          data: { sentCount: { increment: 1 } },
        })
      : Promise.resolve(null),
    logActivity({
      companyId: args.companyId,
      leadId: msg.lead.id,
      userId: args.userId ?? null,
      type: "EMAIL",
      title: `${args.auto ? "Auto-sent" : "Sent"} email · ${subject}`,
      body: msg.body,
      meta: { provider: result.provider, simulated: result.simulated, externalId: result.id ?? null },
    }),
    prisma.metricSnapshot.upsert({
      where: { companyId_key_date: { companyId: args.companyId, key: "emails.sent", date: dayStart } },
      create: { companyId: args.companyId, key: "emails.sent", date: dayStart, value: 1 },
      update: { value: { increment: 1 } },
    }),
  ]);

  return result;
}

/** How many emails were auto/manually sent today (UTC day bucket). */
export async function emailsSentToday(companyId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const snap = await prisma.metricSnapshot.findUnique({
    where: { companyId_key_date: { companyId, key: "emails.sent", date: dayStart } },
  });
  return snap?.value ?? 0;
}

export interface AutoSendSummary {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Full-automation mode: pick up PENDING email approvals, auto-approve and send
 * them, bounded by the company's daily email cap. Only runs when the owner has
 * explicitly enabled `autoSendEmails` — the default remains human-in-the-loop.
 */
export async function autoSendPendingEmails(args: {
  companyId: string;
  dailyEmailCap: number;
  max?: number;
}): Promise<AutoSendSummary> {
  const sentToday = await emailsSentToday(args.companyId);
  const budget = Math.min(args.max ?? 10, Math.max(0, args.dailyEmailCap - sentToday));
  if (budget <= 0) return { sent: 0, failed: 0, skipped: 0 };

  const pending = await prisma.approvalRequest.findMany({
    where: {
      companyId: args.companyId,
      status: "PENDING",
      campaignMessageId: { not: null },
      lead: { is: { email: { not: null }, deletedAt: null } },
    },
    orderBy: { createdAt: "asc" },
    take: budget,
    select: { id: true, campaignMessageId: true, payload: true },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const approval of pending) {
    const payload = (approval.payload ?? {}) as Record<string, unknown>;
    // Only email-kind drafts are auto-sendable; DMs etc. still need a human.
    const kind = typeof payload.kind === "string" ? payload.kind : "EMAIL";
    if (kind !== "EMAIL" && kind !== "FOLLOW_UP") {
      skipped++;
      continue;
    }

    const result = await sendDraftToLead({
      companyId: args.companyId,
      campaignMessageId: approval.campaignMessageId!,
      auto: true,
    });

    if (result.skipped) {
      skipped++;
      continue;
    }

    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: result.ok ? "EXECUTED" : "PENDING",
        decisionNote: result.ok
          ? `Auto-sent via ${result.provider}${result.simulated ? " (simulated)" : ""}`
          : undefined,
        decidedAt: result.ok ? new Date() : undefined,
      },
    });

    if (result.ok) sent++;
    else failed++;
  }

  return { sent, failed, skipped };
}
