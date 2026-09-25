import { describe, it, expect } from "vitest";
import { Kernel } from "../../src/lib/runtime/kernel";
import { MemoryJournal } from "../../src/lib/runtime/journal";
import { sendExactlyOnce, mailIdempotencyKey } from "../../src/lib/runtime/mail";
import { MockMail } from "../helpers/mockMail";

const mailArgs = { to: "marcin.kubicki@example.com", subject: "Łódź", body: "Łódź" };
const fast = { timeoutMs: 40, recheckDelayMs: 5 };

function setup(journal?: MemoryJournal) {
  const k = new Kernel({ journal });
  k.dispatch({ type: "TaskCreated", taskId: "T", goal: "wyślij", kind: "mail" });
  return k;
}

describe("mail: external effect exactly once", () => {
  it("sends once and confirms from Sent", async () => {
    const k = setup();
    const m = new MockMail();
    const r = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r).toMatchObject({ truth: "CONFIRMED", sends: 1 });
    expect(r.evidence).toMatch(/^in Sent: msg-1 to marcin\.kubicki@example\.com/);
    expect(m.calls).toEqual(["findSent", "send", "findSent"]);
    expect(k.state.actions[r.actionId!]).toMatchObject({ status: "CONFIRMED", external: true, idempotencyKey: mailIdempotencyKey(mailArgs) });
  });

  it("a duplicated 'wyślij' does not create a second message", async () => {
    const k = setup();
    const m = new MockMail();
    await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    const again = await sendExactlyOnce(k, m, { taskId: "T", mail: { ...mailArgs } }, fast);
    expect(again).toMatchObject({ truth: "CONFIRMED", duplicate: true, sends: 0 });
    expect(m.sent).toHaveLength(1);
  });

  it("timeout after the provider delivered: Sent is read, no second send", async () => {
    const k = setup();
    const m = new MockMail();
    m.failures = ["timeout-after-send"];
    const r = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r).toMatchObject({ truth: "CONFIRMED", sends: 1 });
    expect(m.sent).toHaveLength(1);
    expect(m.calls).toEqual(["findSent", "send", "findSent"]);
  });

  it("timeout before delivery: Sent is read twice before one retry", async () => {
    const k = setup();
    const m = new MockMail();
    m.failures = ["timeout-before-send"];
    const r = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r).toMatchObject({ truth: "CONFIRMED", sends: 2 });
    expect(m.calls).toEqual(["findSent", "send", "findSent", "findSent", "send", "findSent"]);
    expect(m.sent).toHaveLength(1);
  });

  it("connection reset after delivery: read-back confirms, no retry", async () => {
    const k = setup();
    const m = new MockMail();
    m.failures = ["reset-after-send"];
    const r = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r).toMatchObject({ truth: "CONFIRMED", sends: 1 });
  });

  it("an error before sending is FAILED and releases the key for a later try", async () => {
    const k = setup();
    const m = new MockMail();
    m.failures = ["error-before-send"];
    const r = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r).toMatchObject({ truth: "FAILED", reason: "401 invalid credentials" });
    const later = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(later).toMatchObject({ truth: "CONFIRMED", sends: 1 });
    expect(m.sent).toHaveLength(1);
  });

  it("provider says sent but Sent never shows it: UNKNOWN_AFTER_ATTEMPT, no automatic resend", async () => {
    const k = setup();
    const m = new MockMail();
    m.failures = ["sent-not-visible"];
    const r = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r.truth).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(m.calls.filter((c) => c === "send")).toHaveLength(1);
    // Asking again does not send a second copy either.
    const again = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(again).toMatchObject({ truth: "UNKNOWN_AFTER_ATTEMPT", duplicate: true, sends: 0 });
  });

  it("after a restart an unknown send is resolved from Sent without sending again", async () => {
    const j = new MemoryJournal();
    const k = setup(j);
    const m = new MockMail();
    m.failures = ["timeout-before-send", "timeout-before-send"];
    const first = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, { ...fast, retryAfterReadback: false });
    expect(first.truth).toBe("UNKNOWN_AFTER_ATTEMPT");
    await k.flush();
    // The message arrived late at the provider; JARVIS restarts.
    m.sent.push({ id: "late-1", ...mailArgs, at: Date.now() });
    const k2 = await Kernel.restore(j);
    const r = await sendExactlyOnce(k2, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r).toMatchObject({ truth: "CONFIRMED", duplicate: true, sends: 0 });
    expect(m.calls.filter((c) => c === "send")).toHaveLength(1);
  });

  it("stop before sending: nothing is sent", async () => {
    const k = setup();
    const m = new MockMail();
    k.dispatch({ type: "ControlIntent", control: "stop", tier: 0 });
    const r = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r).toMatchObject({ truth: "FAILED", reason: "cancelled", sends: 0 });
    expect(m.sent).toHaveLength(0);
  });
});
