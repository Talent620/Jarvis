import { CONTENT_KIND_LABELS } from "@/lib/constants";
import type { ContentKind } from "@prisma/client";

export interface CompanyContext {
  name: string;
  industry?: string | null;
  aiContext?: string | null;
  currency?: string | null;
}

export interface LeadContext {
  name: string;
  companyName?: string | null;
  position?: string | null;
  industry?: string | null;
  source?: string | null;
  priority?: string | null;
  score?: number | null;
  stage?: string | null;
}

export interface OfferContext {
  name: string;
  summary?: string | null;
  deliverables?: string[];
  priceFrom?: number | null;
}

/**
 * Strip control chars and clamp length so anything we feed a model — including
 * user-entered notes — is bounded and free of obvious prompt-injection markers.
 */
export function sanitize(input?: string | null, max = 1200): string {
  if (!input) return "";
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/```/g, "ʼʼʼ")
    .replace(/\s+\n/g, "\n")
    .trim()
    .slice(0, max);
}

export const COPILOT_SYSTEM = `You are the AI Copilot inside a sales & client-acquisition operating system used by a small service business.
You are pragmatic, concise and commercially sharp. You help the operator decide what to do next, draft outreach, and read their funnel.
Rules:
- Be specific and actionable. Prefer short paragraphs and tight bullet lists.
- Never invent metrics. If the provided context lacks a number, say so plainly.
- Outreach you write must be legitimate and compliant (no spam, no deception, respect GDPR/RODO and platform rules).
- When you suggest an action, say why in one line.`;

export function companyContextBlock(c: CompanyContext): string {
  return [
    `Company: ${sanitize(c.name, 120)}`,
    c.industry ? `Industry: ${sanitize(c.industry, 80)}` : "",
    c.currency ? `Currency: ${sanitize(c.currency, 8)}` : "",
    c.aiContext ? `Business context: ${sanitize(c.aiContext, 1000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function leadBlock(l?: LeadContext): string {
  if (!l) return "";
  return [
    "Lead:",
    `- Name: ${sanitize(l.name, 120)}`,
    l.companyName ? `- Company: ${sanitize(l.companyName, 120)}` : "",
    l.position ? `- Role: ${sanitize(l.position, 80)}` : "",
    l.industry ? `- Industry: ${sanitize(l.industry, 80)}` : "",
    l.stage ? `- Pipeline stage: ${sanitize(l.stage, 60)}` : "",
    l.priority ? `- Priority: ${sanitize(l.priority, 20)}` : "",
    typeof l.score === "number" ? `- Lead score: ${l.score}/100` : "",
    l.source ? `- Source: ${sanitize(l.source, 40)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function offerBlock(o?: OfferContext): string {
  if (!o) return "";
  return [
    "Offer to sell:",
    `- Name: ${sanitize(o.name, 120)}`,
    o.summary ? `- Summary: ${sanitize(o.summary, 400)}` : "",
    o.deliverables?.length ? `- Includes: ${o.deliverables.map((d) => sanitize(d, 80)).join("; ")}` : "",
    o.priceFrom ? `- Price from: ${o.priceFrom}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const KIND_INSTRUCTIONS: Record<ContentKind, string> = {
  EMAIL:
    "Write a concise cold/outreach email (<=130 words). One clear value hook, one soft CTA. Plain, human tone. Provide a subject line on the first line prefixed with 'Subject: '.",
  DM: "Write a short, friendly direct message (<=60 words) suitable for LinkedIn/Instagram. No links in the first message. End with a low-friction question.",
  AD: "Write 3 ad copy variations. Each: a scroll-stopping hook, 1-2 lines of body, and a CTA. Label them A/B/C.",
  FOLLOW_UP:
    "Write a polite, value-adding follow-up message (<=80 words) that does not guilt-trip. Reference prior contact and add one new reason to reply.",
  POST: "Write a LinkedIn-style post (<=140 words) that shares a useful insight and ends with an engagement prompt. No hashtags spam (max 3).",
  OFFER:
    "Draft a clear one-page offer: problem, what's included (bullets), outcome, timeline, and price framing. Keep it skimmable.",
  SUBJECT_LINE: "Write 6 distinct, non-clickbait email subject lines. Vary angle (curiosity, benefit, specificity).",
  COLD_CALL_SCRIPT:
    "Write a short cold-call opener script: pattern interrupt, one-line reason, permission question, and a fallback if they're busy.",
};

export function buildGenerationPrompt(args: {
  kind: ContentKind;
  company: CompanyContext;
  lead?: LeadContext;
  offer?: OfferContext;
  tone?: string;
  channel?: string;
  userPrompt?: string;
}): { system: string; user: string; promptKey: string } {
  const system = `You write high-converting, compliant sales copy for a small service business.
Honor the requested format exactly. Never fabricate testimonials, numbers, or claims.
Tone: ${sanitize(args.tone, 60) || "warm, confident, concrete"}.
Output ONLY the requested content — no preamble, no explanation.`;

  const user = [
    companyContextBlock(args.company),
    leadBlock(args.lead),
    offerBlock(args.offer),
    args.channel ? `Channel: ${sanitize(args.channel, 30)}` : "",
    args.userPrompt ? `Extra instructions: ${sanitize(args.userPrompt, 600)}` : "",
    "",
    `Task — ${CONTENT_KIND_LABELS[args.kind]}:`,
    KIND_INSTRUCTIONS[args.kind],
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user, promptKey: `generate.${args.kind.toLowerCase()}` };
}
