import type { ContentKind } from "@prisma/client";
import type { CompanyContext, LeadContext, OfferContext } from "./prompts";

const firstName = (name?: string | null) => (name ? name.split(" ")[0] : "there");

export interface MockGenArgs {
  kind: ContentKind;
  company: CompanyContext;
  lead?: LeadContext;
  offer?: OfferContext;
  tone?: string;
  userPrompt?: string;
}

/**
 * Deterministic, presentable copy used when no live model is configured.
 * It references the real lead/offer/company so the product demos convincingly
 * out of the box — and is clearly labelled as a draft in the UI.
 */
export function mockGenerateContent(a: MockGenArgs): string {
  const fn = firstName(a.lead?.name);
  const co = a.company.name;
  const leadCo = a.lead?.companyName ?? "your team";
  const offer = a.offer?.name ?? "what we do";
  const hook =
    a.userPrompt?.trim() ||
    `helping ${a.lead?.industry ?? "teams like " + leadCo} get results faster`;

  switch (a.kind) {
    case "EMAIL":
      return `Subject: A quick idea for ${leadCo}

Hi ${fn},

I came across ${leadCo} and noticed ${hook}. We help similar teams cut the busywork and move quicker — that's the core of ${offer} at ${co}.

Worth a 15-minute call next week to see if it's a fit? Happy to share one concrete idea regardless.

Best,
${co}`;
    case "DM":
      return `Hi ${fn} — saw what ${leadCo} is doing and it's impressive. We work with teams on ${hook}. Open to a quick chat to compare notes?`;
    case "FOLLOW_UP":
      return `Hi ${fn},

Circling back on my last note. Since then I put together a short angle specific to ${leadCo} around ${hook}.

No pressure — should I send it over, or is now not the right time?

${co}`;
    case "AD":
      return `A) "${leadCo} is leaving time on the table."
${offer} turns the repetitive part of your pipeline into one calm workflow.
→ See how it works

B) Stop chasing cold leads manually.
Score, prioritise and reach the right people first — automatically.
→ Start free

C) Built for small teams that punch above their weight.
${offer}: fewer tools, more booked calls.
→ Book a demo`;
    case "POST":
      return `Most small teams don't have a lead problem. They have a follow-up problem.

The deals you "lost" usually weren't lost — they were forgotten on day 4.

What changed it for us: ${hook}, plus a system that surfaces the next action automatically.

How do you keep follow-ups from slipping?`;
    case "OFFER":
      return `${offer} — one-page overview

The problem
${leadCo} is spending hours on manual outreach and follow-up that rarely gets measured.

What's included
${(a.offer?.deliverables?.length
        ? a.offer.deliverables
        : ["Lead capture & scoring setup", "Pipeline + follow-up automation", "Message & ad templates", "Weekly performance report"]
      )
        .map((d) => `• ${d}`)
        .join("\n")}

Outcome
A predictable, measurable acquisition system you can actually run.

Timeline: 2–3 weeks to live.
${a.offer?.priceFrom ? `Investment: from ${a.offer.priceFrom} ${a.company.currency ?? "PLN"}.` : "Investment: scoped to your needs."}`;
    case "SUBJECT_LINE":
      return `1. A quick idea for ${leadCo}
2. ${fn}, worth 15 minutes?
3. The follow-up gap (and how to close it)
4. One angle for ${leadCo}
5. Should I send this over?
6. ${a.lead?.industry ?? "Your team"} → fewer tools, more calls`;
    case "COLD_CALL_SCRIPT":
      return `Opener: "Hi ${fn}, I know I'm calling out of the blue — can I take 20 seconds and you tell me if it's worth continuing?"

Reason: "We help teams like ${leadCo} with ${hook}, without adding more tools."

Permission: "Does it make sense to grab 15 minutes this week?"

If busy: "No problem — what's the best way to send a one-line summary?"`;
    default:
      return `Draft for ${leadCo}: ${hook}.`;
  }
}

export interface MockCopilotSnapshot {
  totalLeads: number;
  hotLeads: number;
  openTasks: number;
  overdueTasks: number;
  pendingApprovals: number;
  wonValue: number;
  pipelineValue: number;
  replyRate: number;
  currency: string;
}

export function mockCopilot(message: string, s: MockCopilotSnapshot): string {
  const m = message.toLowerCase();
  const money = (n: number) =>
    new Intl.NumberFormat("pl-PL", { style: "currency", currency: s.currency, maximumFractionDigits: 0 }).format(n);

  if (m.includes("today") || m.includes("dzi") || m.includes("next") || m.includes("focus")) {
    return `Here's where I'd focus today:

1. ${s.hotLeads} hot lead${s.hotLeads === 1 ? "" : "s"} (score ≥ 75) — reach out before they cool.
2. ${s.overdueTasks} overdue task${s.overdueTasks === 1 ? "" : "s"} ${s.overdueTasks ? "— clear these first" : "— nice, nothing overdue"}.
3. ${s.pendingApprovals} AI draft${s.pendingApprovals === 1 ? "" : "s"} waiting in Approvals.

Why: hot leads + overdue follow-ups are where deals leak fastest. Want me to draft the first outreach?`;
  }
  if (m.includes("summary") || m.includes("how are we") || m.includes("podsum") || m.includes("status")) {
    return `Quick read on the business:

• Pipeline: ${money(s.pipelineValue)} across ${s.totalLeads} leads (${s.hotLeads} hot).
• Won so far: ${money(s.wonValue)}.
• Reply rate: ${s.replyRate}%.
• Open tasks: ${s.openTasks} (${s.overdueTasks} overdue).

${s.replyRate < 15 ? "Reply rate looks low — your messaging or targeting is the lever to pull." : "Reply rate is healthy — focus on volume to the right segments."}`;
  }
  if (m.includes("improve") || m.includes("funnel") || m.includes("popraw") || m.includes("lejek")) {
    return `Funnel suggestions based on current numbers:

• ${s.replyRate < 15 ? "Reply rate is the bottleneck. Tighten the first line and personalise the hook per segment." : "Top of funnel is converting — add volume to your best source."}
• ${s.overdueTasks > 0 ? `You have ${s.overdueTasks} overdue follow-ups; consistency here usually lifts conversion more than new leads.` : "Follow-ups are on time — keep it up."}
• Move qualified leads to a concrete offer faster — speed-to-proposal correlates with close rate.

I can draft the messages for any of these.`;
  }
  return `I can help you decide what to do next, draft outreach, read your funnel, or summarise the business.

Right now: ${s.totalLeads} leads, ${s.hotLeads} hot, ${s.openTasks} open tasks, ${s.pendingApprovals} approvals pending, ${money(s.pipelineValue)} in pipeline.

Try: "what should I focus on today?", "summarise the business", or "how do I improve the funnel?"

(Note: running on the built-in mock — add an AI key in .env for live, tailored answers.)`;
}
