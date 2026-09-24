// Mock Gmail: a Sent folder, scripted failures and a call log (order of send/findSent).
import type { MailService, OutgoingMail, SendOutcome, SentRecord } from "../../src/lib/runtime/mail";
import type { CapabilityState } from "../../src/lib/runtime/types";

export type Failure =
  | "timeout-after-send" // delivered, but the response never comes back
  | "timeout-before-send" // nothing delivered, the request hangs
  | "error-before-send" // auth or validation error, nothing delivered
  | "reset-after-send" // delivered, connection reset (maybeSent)
  | "sent-not-visible"; // provider says sent, Sent never shows it

export class MockMail implements MailService {
  readonly id = "mock-gmail";
  sent: SentRecord[] = [];
  calls: string[] = [];
  failures: Failure[] = [];
  private seq = 0;
  constructor(private readonly hangMs = 50) {}
  async capabilities(): Promise<CapabilityState[]> {
    return [
      { id: "mail.send", status: "available", checkedAt: 0, provider: this.id },
      { id: "mail.sent_readback", status: "available", checkedAt: 0, provider: this.id },
    ];
  }
  private deliver(m: OutgoingMail, visible = true): SentRecord {
    const r = { id: `msg-${++this.seq}`, ...m, at: Date.now() };
    if (visible) this.sent.push(r);
    return r;
  }
  async send(m: OutgoingMail): Promise<SendOutcome> {
    this.calls.push("send");
    const f = this.failures.shift();
    if (f === "timeout-after-send") { this.deliver(m); return new Promise(() => {}); }
    if (f === "timeout-before-send") return new Promise(() => {});
    if (f === "error-before-send") return { status: "failed", error: "401 invalid credentials", maybeSent: false };
    if (f === "reset-after-send") { this.deliver(m); return { status: "failed", error: "ECONNRESET", maybeSent: true }; }
    if (f === "sent-not-visible") { const r = this.deliver(m, false); return { status: "sent", providerId: r.id }; }
    const r = this.deliver(m);
    await new Promise((res) => setTimeout(res, 1));
    return { status: "sent", providerId: r.id };
  }
  async findSent(q: OutgoingMail & { since: number }): Promise<SentRecord | null> {
    this.calls.push("findSent");
    return this.sent.find((r) => r.to === q.to && r.subject === q.subject && r.body === q.body && r.at >= q.since) ?? null;
  }
}
