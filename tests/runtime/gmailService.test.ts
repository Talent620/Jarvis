// Contract tests for the production Gmail MailService with a fake transport that behaves like
// Gmail search over Sent (snippets are HTML-escaped and cut, subjects exact). No real account.
import { describe, it, expect } from "vitest";
import { GmailMailService, type GmailListItem, type GmailTransport } from "../../src/lib/runtime/gmailService";
import { sendExactlyOnce } from "../../src/lib/runtime/mail";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime } from "../../src/lib/runtime/lanes/runtime";
import { MemoryBrowser } from "../helpers/memoryBrowser";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");

class FakeGmail implements GmailTransport {
  readonly id = "fake";
  sent: (GmailListItem & { body: string; at: number })[] = [];
  queries: string[] = [];
  calls: string[] = [];
  isConnected = true;
  sendReplies: ({ error: string } | "deliver-then-throw")[] = [];
  async connected() { return this.isConnected; }
  async send(m: { to: string; subject: string; body: string }) {
    this.calls.push("send");
    const r = this.sendReplies.shift();
    if (r === "deliver-then-throw") { this.deliver(m); throw new Error("socket hang up"); }
    if (r) return r;
    return { ok: true, id: this.deliver(m) };
  }
  private deliver(m: { to: string; subject: string; body: string }) {
    const id = `g${this.sent.length + 1}`;
    this.sent.unshift({ id, to: m.to, from: "me@example.com", subject: m.subject, snippet: esc(m.body).slice(0, 100), body: m.body, at: Date.now(), date: new Date().toUTCString() });
    return id;
  }
  async list(o: { query: string; max: number }) {
    this.calls.push("list");
    this.queries.push(o.query);
    const to = /to:(\S+)/.exec(o.query)?.[1];
    return { messages: this.sent.filter((m) => !to || m.to === to).slice(0, o.max).map(({ body: _b, at: _a, ...rest }) => rest) };
  }
}

const mailArgs = { to: "marcin.kubicki@example.com", subject: "Łódź", body: "Łódź" };
const fast = { timeoutMs: 200, recheckDelayMs: 5 };
const kernelWithTask = () => { const k = new Kernel(); k.dispatch({ type: "TaskCreated", taskId: "T", goal: "g", kind: "k" }); return k; };

describe("GmailMailService contract", () => {
  it("sends once and confirms from Sent through a Gmail search query", async () => {
    const g = new FakeGmail();
    const r = await sendExactlyOnce(kernelWithTask(), new GmailMailService(g), { taskId: "T", mail: mailArgs }, fast);
    expect(r).toMatchObject({ truth: "CONFIRMED", sends: 1 });
    expect(r.evidence).toMatch(/^in Sent: g1 to marcin\.kubicki@example\.com/);
    expect(g.calls).toEqual(["list", "send", "list"]);
    expect(g.queries[0]).toMatch(/^in:sent to:marcin\.kubicki@example\.com subject:\(Łódź\) newer_than:[12]d$/); // 24 h window plus the ms since it was computed
  });

  it("matches HTML-escaped, truncated snippets and quotes in the subject cannot break the query", async () => {
    const g = new FakeGmail();
    const body = `It's "Łódź" <nocą> & dłuższy tekst, ${"x".repeat(200)}`;
    const mail = { to: "a@example.com", subject: `Temat "z" cudzysłowem`, body };
    const r = await sendExactlyOnce(kernelWithTask(), new GmailMailService(g), { taskId: "T", mail }, fast);
    expect(r.truth).toBe("CONFIRMED");
    expect(g.queries.every((q) => !q.includes("\""))).toBe(true);
  });

  it("a refused request (401) is a clean failure, nothing is retried", async () => {
    const g = new FakeGmail();
    g.sendReplies = [{ error: "401 Unauthorized: Google niepołączone." }];
    const r = await sendExactlyOnce(kernelWithTask(), new GmailMailService(g), { taskId: "T", mail: mailArgs }, fast);
    expect(r.truth).toBe("FAILED");
    expect(g.calls.filter((c) => c === "send")).toHaveLength(1);
  });

  it("a network error after delivery is resolved from Sent, one message", async () => {
    const g = new FakeGmail();
    g.sendReplies = ["deliver-then-throw"];
    const r = await sendExactlyOnce(kernelWithTask(), new GmailMailService(g), { taskId: "T", mail: mailArgs }, fast);
    expect(r).toMatchObject({ truth: "CONFIRMED", sends: 1 });
    expect(g.sent).toHaveLength(1);
  });

  it("an ambiguous error with nothing in Sent stays unknown after one guarded retry", async () => {
    const g = new FakeGmail();
    g.sendReplies = [{ error: "ETIMEDOUT" }, { error: "ETIMEDOUT" }];
    const r = await sendExactlyOnce(kernelWithTask(), new GmailMailService(g), { taskId: "T", mail: mailArgs }, fast);
    expect(r.truth).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(g.calls.filter((c) => c === "send")).toHaveLength(2);
  });

  it("a message with the same subject to someone else, or older than the window, is not proof", async () => {
    const g = new FakeGmail();
    g.sent.push({ id: "old", to: "marcin.kubicki@example.com", subject: "Łódź", snippet: "Łódź", body: "Łódź", at: 0, date: new Date(0).toUTCString() });
    g.sent.push({ id: "other", to: "someone@example.com", subject: "Łódź", snippet: "Łódź", body: "Łódź", at: Date.now(), date: new Date().toUTCString() });
    const svc = new GmailMailService(g);
    expect(await svc.findSent({ ...mailArgs, since: Date.now() - 3600_000 })).toBeNull();
  });

  it("capabilities say needs_permission when Gmail is not connected", async () => {
    const g = new FakeGmail();
    g.isConnected = false;
    const caps = await new GmailMailService(g).capabilities();
    expect(caps.map((c) => [c.id, c.status])).toEqual([["mail.send", "needs_permission"], ["mail.sent_readback", "needs_permission"]]);
  });

  it("the golden steps 1-8 run on the same runtime with the Gmail service", async () => {
    const g = new FakeGmail();
    const kernel = new Kernel();
    const rt = new JarvisRuntime({
      kernel, env: new MemoryBrowser(),
      session: { youtubeUrl: "http://yt.test/", mail: new GmailMailService(g), mailOptions: fast, contacts: async () => [{ id: "m1", name: "Marcin Kubicki", emails: ["marcin.kubicki@example.com"], source: "fixture" }] },
    });
    await rt.start();
    for (const t of ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "Zjedź trochę niżej.", "Znajdź komentarze.", "Pierwszy komentarz.", "Zaznacz pierwsze cztery litery.", "Skopiuj."]) rt.onText(t);
    await rt.idle();
    const send = rt.onText("Wyślij to mailem Marcinowi.");
    for (let i = 0; i < 200 && !Object.keys(kernel.state.consents).length; i++) await new Promise((r) => setTimeout(r, 5));
    rt.onText("tak");
    await rt.idle();
    expect(send.result?.truth).toBe("CONFIRMED");
    expect(g.sent.map((m) => [m.to, m.body])).toEqual([["marcin.kubicki@example.com", "Łódź"]]);
    rt.stop();
  });
});
