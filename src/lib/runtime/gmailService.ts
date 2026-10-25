// Production MailService over Gmail (mission 5.9): send through the desktop bridge or the BFF,
// confirm by finding the message in Sent. The transport is injected, so the contract is tested
// without a real account; the real account is acceptance territory (NEEDS_HARDWARE here).

import type { MailService, OutgoingMail, SendOutcome, SentRecord } from "./mail";
import type { CapabilityState } from "./types";

export interface GmailListItem {
  id: string;
  from?: string;
  to?: string;
  subject: string;
  snippet: string;
  date?: string;
}

export interface GmailTransport {
  readonly id: string;
  connected(): Promise<boolean>;
  send(msg: OutgoingMail): Promise<{ ok?: boolean; id?: string; error?: string }>;
  list(opts: { query: string; max: number }): Promise<{ messages?: GmailListItem[]; error?: string }>;
}

/** Errors that prove the request was refused before anything was sent. */
const REFUSED = /\b(40[0-4]|invalid|niepo[lł][aą]czon|unauthori[sz]ed|forbidden|skonfiguruj|brak (tokenu|konta)|reauth|invalid_grant|quota)\b/i;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);
const norm = (s: string) => decode(s).replace(/\s+/g, " ").trim().toLowerCase();
/** Gmail search operands cannot carry quotes; keep the words. */
const searchable = (s: string) => s.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export class GmailMailService implements MailService {
  readonly id: string;
  constructor(private readonly transport: GmailTransport, private readonly now: () => number = () => Date.now()) {
    this.id = `gmail:${transport.id}`;
  }

  async capabilities(): Promise<CapabilityState[]> {
    const ok = await this.transport.connected().catch(() => false);
    const status = ok ? "available" as const : "needs_permission" as const;
    const at = this.now();
    return [
      { id: "mail.send", status, checkedAt: at, provider: this.id, detail: ok ? undefined : "Gmail is not connected" },
      { id: "mail.sent_readback", status, checkedAt: at, provider: this.id, detail: ok ? undefined : "Gmail is not connected" },
    ];
  }

  async send(mail: OutgoingMail): Promise<SendOutcome> {
    const r = await this.transport.send(mail); // a throw is handled by sendExactlyOnce as "maybe sent"
    if (r?.error) return { status: "failed", error: r.error, maybeSent: !REFUSED.test(r.error) };
    return { status: "sent", providerId: r?.id };
  }

  async findSent(q: OutgoingMail & { since: number }): Promise<SentRecord | null> {
    const days = Math.max(1, Math.ceil((this.now() - q.since) / 86_400_000));
    const query = `in:sent to:${searchable(q.to)} subject:(${searchable(q.subject)}) newer_than:${days}d`;
    const r = await this.transport.list({ query, max: 10 });
    if (r.error) throw new Error(r.error);
    const want = norm(q.body).slice(0, 60);
    const hit = (r.messages ?? []).find((m) => {
      if (norm(m.subject) !== norm(q.subject)) return false;
      if (m.to && !norm(m.to).includes(q.to.trim().toLowerCase())) return false;
      const snip = norm(m.snippet);
      return snip.startsWith(want) || want.startsWith(snip.slice(0, Math.max(1, snip.length - 1)));
    });
    if (!hit) return null;
    const at = hit.date ? Date.parse(hit.date) : NaN;
    if (Number.isFinite(at) && at < q.since) return null;
    return { id: hit.id, to: q.to, subject: decode(hit.subject), body: decode(hit.snippet), at: Number.isFinite(at) ? at : this.now() };
  }
}
