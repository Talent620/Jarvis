import type { CallStatus, Lead, WebsiteAudit } from "@prisma/client";

/**
 * Deterministic sales playbook ("battle card") for a lead: who they are, the
 * single best angle to hit, what's already been done, and the next moves that
 * statistically win local-business deals. Grounded in cold-outreach research:
 * 93% of converted leads need 6+ touches, multi-channel lifts replies ~37%,
 * best call windows for owners are Tue–Thu 9–11 and 15–17, and a free
 * mini-audit / homepage demo is the classic foot-in-the-door for web work.
 */

export interface PlaybookAngle {
  title: string;
  detail: string;
  power: "high" | "medium";
}

export interface PlaybookStatusItem {
  label: string;
  detail: string | null;
  done: boolean;
}

export interface PlaybookMove {
  title: string;
  detail: string;
}

export interface PlaybookObjection {
  objection: string;
  answer: string;
}

export interface Playbook {
  summary: string;
  angles: PlaybookAngle[];
  opener: string;
  status: PlaybookStatusItem[];
  moves: PlaybookMove[];
  objections: PlaybookObjection[];
  callWindow: string;
}

export interface PlaybookInput {
  lead: Pick<
    Lead,
    | "name"
    | "companyName"
    | "industry"
    | "region"
    | "source"
    | "tags"
    | "hasWebsite"
    | "auditScore"
    | "callStatus"
    | "callAttempts"
    | "lastCallAt"
    | "score"
    | "createdAt"
  >;
  stageName?: string | null;
  audit?: Pick<
    WebsiteAudit,
    "overall" | "loadTimeMs" | "https" | "mobileFriendly" | "issues"
  > | null;
  emailsSent: number;
  lastEmailAt?: Date | null;
  lastCallNote?: string | null;
}

const NEEDS_CALL: CallStatus[] = ["NOT_CALLED", "NO_ANSWER", "VOICEMAIL"];

function buildAngles(input: PlaybookInput): PlaybookAngle[] {
  const { lead, audit } = input;
  const angles: PlaybookAngle[] = [];

  if (lead.hasWebsite === false || lead.tags.includes("no-website")) {
    angles.push({
      title: "No website — invisible on Google",
      power: "high",
      detail:
        "Customers searching for them right now are finding competitors instead. Easiest pitch there is: don't sell 'a website', sell the customers they're losing every week.",
    });
  }
  if (audit) {
    if (audit.loadTimeMs != null && audit.loadTimeMs > 3000) {
      angles.push({
        title: `Site loads in ${(audit.loadTimeMs / 1000).toFixed(1)}s`,
        power: "high",
        detail:
          "Visitors abandon after ~3 seconds — every extra second is lost calls. Quote their real number back to them; specifics beat any sales line.",
      });
    }
    if (!audit.https) {
      angles.push({
        title: "Browser shows “Not secure”",
        power: "high",
        detail:
          "Chrome literally warns their customers away. Show a screenshot of the warning on their own site — it sells itself.",
      });
    }
    if (audit.mobileFriendly === false) {
      angles.push({
        title: "Broken on phones",
        power: "high",
        detail:
          "Most local searches happen on a phone. Open their site on your phone during the call/meeting and let them see it.",
      });
    }
    if (audit.overall < 50 && angles.length === 0) {
      angles.push({
        title: `Website health only ${audit.overall}/100`,
        power: "medium",
        detail: "Position the rebuild as recovering lost customers, not as a cost.",
      });
    }
  }
  if (lead.tags.includes("new-company")) {
    angles.push({
      title: "Freshly registered business",
      power: "medium",
      detail:
        "They're setting everything up right now — site, Google Business Profile, logo. Be first with a starter package before an agency with billboards gets there.",
    });
  }
  if (angles.length === 0) {
    angles.push({
      title: "More customers from Google",
      power: "medium",
      detail:
        "No obvious weakness on file — run the website audit first, then lead with whatever it finds (speed, reviews, visibility).",
    });
  }
  return angles.slice(0, 3);
}

function buildOpener(input: PlaybookInput, angles: PlaybookAngle[]): string {
  const company = input.lead.companyName ?? input.lead.name;
  const top = angles[0];
  const fact =
    top.title === "No website — invisible on Google"
      ? `I looked for your website before calling and couldn't find one — when people search “${input.lead.industry ?? "your service"}${input.lead.region ? ` ${input.lead.region}` : ""}” on Google, they're finding your competitors`
      : input.audit?.loadTimeMs && input.audit.loadTimeMs > 3000
        ? `I checked your website before calling — it takes ${(input.audit.loadTimeMs / 1000).toFixed(1)} seconds to open on a phone, and most visitors give up after three`
        : input.audit && !input.audit.https
          ? `I checked your website before calling — browsers are flagging it as “Not secure”, which scares customers off`
          : `I had a look at how ${company} shows up on Google before calling`;
  return `“Hi, this is [your name] from [your company]. I'll be brief — ${fact}. We fix exactly that for ${input.lead.industry ?? "local businesses"}. If I send you a free one-page audit, would you take a 10-minute call about it this week?”`;
}

function buildStatus(input: PlaybookInput): PlaybookStatusItem[] {
  const { lead } = input;
  const called = lead.callAttempts > 0;
  const emailed = input.emailsSent > 0;
  const audited = lead.auditScore != null || lead.hasWebsite === false;
  const meeting = lead.callStatus === "MEETING_BOOKED";
  const proposal = (input.stageName ?? "").toLowerCase().includes("proposal") ||
    (input.stageName ?? "").toLowerCase().includes("negotiation");

  return [
    {
      label: "Called",
      done: called,
      detail: called
        ? `${lead.callAttempts}× · last outcome: ${lead.callStatus.replaceAll("_", " ").toLowerCase()}`
        : "no attempts yet",
    },
    {
      label: "Email sent",
      done: emailed,
      detail: emailed ? `${input.emailsSent}× sent` : "nothing sent yet",
    },
    {
      label: "Website audited",
      done: audited,
      detail:
        lead.hasWebsite === false
          ? "no website (that IS the pitch)"
          : lead.auditScore != null
            ? `health ${lead.auditScore}/100`
            : "run the audit for talking points",
    },
    { label: "Meeting booked", done: meeting, detail: meeting ? null : "not yet" },
    {
      label: "Proposal sent",
      done: proposal,
      detail: input.stageName ? `stage: ${input.stageName}` : null,
    },
  ];
}

function buildMoves(input: PlaybookInput): PlaybookMove[] {
  const { lead } = input;
  const moves: PlaybookMove[] = [];
  const touches = lead.callAttempts + input.emailsSent;

  if (lead.auditScore == null && lead.hasWebsite !== false) {
    moves.push({
      title: "Run the website audit first",
      detail:
        "Call with their real numbers (“your site loads in 8s”) instead of a generic pitch — specifics double engagement.",
    });
  }

  switch (lead.callStatus) {
    case "NOT_CALLED":
      moves.push(
        {
          title: "First call — lead with the free mini-audit",
          detail:
            "Don't sell the website on call #1. Offer the free one-page audit (or a free homepage mock-up) — a small yes that earns the meeting.",
        },
        {
          title: "Same day: short follow-up email",
          detail:
            "3 sentences + the audit attached. Multi-channel (call + email) lifts replies ~37% vs phone only.",
        },
      );
      break;
    case "NO_ANSWER":
    case "VOICEMAIL":
      moves.push(
        {
          title: "Switch the time slot, not just redial",
          detail:
            "Try the other window (morning ↔ late afternoon). Owners pick up best Tue–Thu, 9–11 and 15–17 — and five minutes before the hour.",
        },
        {
          title: "Send the audit by email between attempts",
          detail:
            "“Tried to reach you — here's the 1-page audit of your site, worth 2 minutes.” Now the next call isn't cold anymore.",
        },
      );
      break;
    case "CALLBACK":
      moves.push(
        {
          title: "Prepare one before/after for the callback",
          detail:
            "A local example with numbers (“rebuilt a site like yours: 24→96 PageSpeed, calls up 40%”). One concrete story beats ten features.",
        },
        {
          title: "Call exactly when promised",
          detail: "Punctuality is the first proof you deliver on time.",
        },
      );
      break;
    case "INTERESTED":
      moves.push(
        {
          title: "Send proposal within 24h — strike while hot",
          detail:
            "One page, three options (good/better/best — most pick the middle), price anchored against the customers they're losing.",
        },
        {
          title: "Book the meeting with two concrete slots",
          detail:
            "“Tuesday 10:00 or Thursday 15:30?” — choosing a time is easier than choosing whether to meet.",
        },
      );
      break;
    case "MEETING_BOOKED":
      moves.push(
        {
          title: "Deliver a small win before the meeting",
          detail:
            "Send the audit + one quick free fix suggestion. Reciprocity: people buy from those who already helped them.",
        },
        {
          title: "Close with a concrete start date",
          detail:
            "“We can have the first version live in 7 days — shall we start Monday?” Deadlines convert maybes.",
        },
      );
      break;
    case "NOT_INTERESTED":
      moves.push({
        title: "Park it, don't delete it — re-engage in 60–90 days",
        detail:
          "“Not now” usually means “not yet”. Set a re-engage task; circumstances (and seasons) change.",
      });
      break;
    default:
      break;
  }

  if (touches >= 3 && touches < 6 && lead.callStatus !== "NOT_INTERESTED" && NEEDS_CALL.includes(lead.callStatus)) {
    moves.push({
      title: `Don't stop at ${touches} touches`,
      detail:
        "93% of converted leads need 6+ touchpoints and 60% of customers say no four times before yes. Alternate channel each time: call → email → call → SMS/LinkedIn.",
    });
  }

  return moves.slice(0, 3);
}

const OBJECTIONS: PlaybookObjection[] = [
  {
    objection: "“I get clients through word of mouth.”",
    answer:
      "Perfect — a website multiplies word of mouth. When someone recommends you, the first thing the new customer does is Google you. No site = a recommendation that dies on the way.",
  },
  {
    objection: "“It's too expensive.”",
    answer:
      "Break it down: that's ~X PLN/month over a year. What's one customer worth to you? If the site brings two a month, it pays for itself many times over. Sell ROI, not the price tag.",
  },
  {
    objection: "“My nephew / a friend will do it.”",
    answer:
      "Great that you have someone! Take the free audit anyway — if your nephew builds it, the audit tells him exactly what to fix. (They keep your number; nephews rarely deliver.)",
  },
  {
    objection: "“I have a Facebook page, that's enough.”",
    answer:
      "Facebook reaches people who already follow you. Google catches people actively searching with money in hand — “plumber near me” never lands on a fan page. You need both.",
  },
  {
    objection: "“I don't have time for this.”",
    answer:
      "That's exactly why this works — you give us 20 minutes total, we do everything else. First version in 7 days without you lifting a finger.",
  },
];

export function buildPlaybook(input: PlaybookInput): Playbook {
  const { lead } = input;
  const angles = buildAngles(input);

  const descriptors = [
    lead.industry,
    lead.region,
    lead.hasWebsite === false
      ? "no website"
      : lead.auditScore != null
        ? `weak site (${lead.auditScore}/100)`
        : null,
    lead.tags.includes("new-company") ? "newly registered" : null,
  ].filter(Boolean);

  return {
    summary: `${lead.companyName ?? lead.name}${descriptors.length ? ` — ${descriptors.join(" · ")}` : ""}. Lead score ${lead.score}/100.`,
    angles,
    opener: buildOpener(input, angles),
    status: buildStatus(input),
    moves: buildMoves(input),
    objections: OBJECTIONS,
    callWindow:
      "Best windows: Tue–Thu · 9:00–11:00 or 15:00–17:00 (owner pick-up peaks; avoid lunch). Bonus: dial ~5 min before the full hour.",
  };
}
